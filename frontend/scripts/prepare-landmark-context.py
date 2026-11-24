"""Crop the supplied road and water meshes around the two landmarks.

Run from the checkout with Python, NumPy and Shapely 2 installed. The resulting
small plan files live with the other locally generated model assets.
"""
from pathlib import Path
import json
import struct

import numpy as np
from shapely import box, polygons, union_all

PROJECT = Path(__file__).resolve().parents[2]
SOURCE = PROJECT / "docs" / "地图模型"
OUT = PROJECT / "frontend" / "public" / "maps" / "local-model"
# X/Z windows in the local Blender scene, including the roads at each entrance.
SITES = {
    "tianjie": (-3975, -2130, -3290, -1450),
    "jingxi": (-3515, -1080, -2780, -360),
}


def rings(geometry):
    if geometry.geom_type == "Polygon" and geometry.area > 1:
        points = [geometry.exterior.coords, *[hole.coords for hole in geometry.interiors]]
        yield [[[round(value, 2) for value in coordinate] for coordinate in ring] for ring in points]
    elif geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
        for child in geometry.geoms:
            yield from rings(child)


def project_meshes(path):
    raw = path.read_bytes()
    length = struct.unpack_from("<I", raw, 12)[0]
    document = json.loads(raw[20:20 + length])
    binary = 28 + length

    def accessor(index):
        source = document["accessors"][index]
        view = document["bufferViews"][source["bufferView"]]
        kind = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[source["componentType"]]
        dimensions = 3 if source["type"] == "VEC3" else 1
        offset = binary + view.get("byteOffset", 0) + source.get("byteOffset", 0)
        size = np.dtype(kind).itemsize
        stride = view.get("byteStride", dimensions * size)
        return np.ndarray((source["count"], dimensions), dtype=kind, buffer=raw,
                          offset=offset, strides=(stride, size))

    for node in document["nodes"]:
        if "mesh" not in node:
            continue
        for primitive in document["meshes"][node["mesh"]]["primitives"]:
            positions = accessor(primitive["attributes"]["POSITION"]) * np.asarray(node.get("scale", (1, 1, 1)))
            axis = np.asarray(node.get("rotation", (0, 0, 0, 1)))
            vector, w = axis[:3], axis[3]
            positions = (2 * (positions @ vector)[:, None] * vector
                         + (w*w - vector @ vector) * positions
                         + 2*w * np.cross(vector, positions)
                         + node.get("translation", (0, 0, 0)))
            triangles = accessor(primitive["indices"]).reshape(-1, 3)
            yield node.get("name", ""), positions[:, (0, 2)][triangles]


def clip_mesh(triangles, bounds, viewport):
    left, top, right, bottom = bounds
    minimum = triangles.min(axis=1)
    maximum = triangles.max(axis=1)
    inside = ((maximum[:, 0] >= left) & (minimum[:, 0] <= right)
              & (maximum[:, 1] >= top) & (minimum[:, 1] <= bottom))
    cuts = triangles[inside]
    if not len(cuts):
        return []
    u = cuts[:, 1] - cuts[:, 0]
    v = cuts[:, 2] - cuts[:, 0]
    cuts = cuts[np.abs(u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]) > .002]
    if not len(cuts):
        return []
    return list(rings(union_all(polygons(cuts), grid_size=.08).intersection(viewport).simplify(.4)))


def main():
    sites = {name: {"bounds": bounds, "roads": [], "water": []} for name, bounds in SITES.items()}
    viewports = {name: box(*bounds) for name, bounds in SITES.items()}
    for layer, source in (("roads", "路网.glb"), ("water", "水域.glb")):
        for name, triangles in project_meshes(SOURCE / source):
            for site, data in sites.items():
                shapes = clip_mesh(triangles, data["bounds"], viewports[site])
                if shapes:
                    data[layer].append({"name": name, "polygons": shapes})
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in sites.items():
        target = OUT / f"{name}-context.json"
        target.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        print(f"{name}: {len(data['roads'])} routes, {len(data['water'])} water features, {target.stat().st_size} bytes")


if __name__ == "__main__":
    main()

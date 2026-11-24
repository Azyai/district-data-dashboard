"""Build compact geographic overlays from the supplied offline dashboard, without external map requests."""
from pathlib import Path
import json
import struct
import sys

import numpy as np
from shapely import line_merge, polygons, union_all
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.strtree import STRtree

root = Path(__file__).resolve().parents[2]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "docs/门头沟区基层治理平台"
data = source / "平台/public/data"
out = root / "frontend/public/monitoring"
out.mkdir(parents=True, exist_ok=True)


def read(name):
    return json.loads((data / (name + ".json")).read_text(encoding="utf8"))


def save(name, obj):
    (out / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf8")


def rotation(quat):
    x, y, z, w = quat
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])


# Ground-plane transform of the reference platform's georeferenced terrain.
plane = rotation([.7070979476, .003535517, -.0035355166, .707097888])[[0, 2], :2]
plane *= [.995499909, .995500028]
inverse = np.linalg.inv(plane)
def geographic(points):
    local = np.asarray(points) @ inverse.T
    lon = 115.416805 + (local[:, 0] + 63568.55078125) / 64423.8828125 * .752440
    lat = 39.810992 + (7712.12109375 - local[:, 1]) / 40530.17578125 * .366924
    return np.stack((lon, lat), axis=1).round(5).tolist()


villages = read("villages")["features"]
village_polygons = []
village_props = []
features = []
for village in villages:
    lines = []
    for ring in village["rings"]:
        if len(ring) < 4:
            continue
        polygon = Polygon(geographic(ring))
        village_polygons.append(polygon)
        village_props.append(village)
        line = LineString(ring).simplify(12)
        lines.append(geographic(line.coords))
    features.append(dict(type="Feature", properties={"name": village["name"], "town": village["town"]},
                         geometry=dict(type="MultiLineString", coordinates=lines)))
save("grid.geojson", dict(type="FeatureCollection", features=features))
village_tree = STRtree(village_polygons)


def village_at(location, town):
    point = Point(location)
    for index in village_tree.query(point):
        if village_props[index]["town"] == town and village_polygons[index].covers(point):
            return village_props[index]["name"]
    return None


summary = read("summary")
catalog = {key: summary[key] for key in ("baseHour", "hourly", "flow", "towns", "grids", "roads", "corridors", "waters")}
catalog["villages"] = [dict({key: row[key] for key in ("name", "town", "micro", "buildings")},
                           point=geographic([row["centroid"]])[0]) for row in villages]
for water in catalog["waters"]:
    water["village"] = village_at([water["lon"], water["lat"]], water["town"])

def load_meshes(name):
    with (source / "门头沟模型" / name).open("rb") as file:
        file.seek(12)
        size, _ = struct.unpack("<I4s", file.read(8))
        gltf = json.loads(file.read(size))
        size, _ = struct.unpack("<I4s", file.read(8))
        buffer = file.read(size)
    for node in gltf["nodes"]:
        if "mesh" not in node:
            continue
        primitives = []
        for primitive in gltf["meshes"][node["mesh"]]["primitives"]:
            coords = accessor(gltf, buffer, primitive["attributes"]["POSITION"]) * node.get("scale", [1, 1, 1])
            coords = coords @ rotation(node.get("rotation", [0, 0, 0, 1])).T + node.get("translation", [0, 0, 0])
            indices = accessor(gltf, buffer, primitive["indices"])
            primitives.append((coords[:, [0, 2]], indices))
        yield node["name"], primitives


def accessor(gltf, buffer, index):
    item = gltf["accessors"][index]
    view = gltf["bufferViews"][item["bufferView"]]
    columns = 3 if item["type"] == "VEC3" else 1
    dtype = {5123: "<u2", 5125: "<u4", 5126: "<f4"}[item["componentType"]]
    return np.frombuffer(buffer, dtype=dtype, count=item["count"]*columns,
                         offset=view.get("byteOffset", 0)+item.get("byteOffset", 0)).reshape((-1, columns))


def ribbon_lines(coords, indices):
    # Adjacent ribbon vertices collapse into 25 m cells. Keep only connections present
    # in source triangles and discard triangulation cycles before merging paths.
    _, ids = np.unique(np.floor(coords / 25).astype(int), axis=0, return_inverse=True)
    ids = ids.ravel()
    counts = np.bincount(ids)
    centers = np.column_stack([np.bincount(ids, coords[:, axis])/counts for axis in (0, 1)])
    tri = ids[indices].reshape((-1, 3))
    edges = np.unique(np.sort(tri[:, [0,1,1,2,2,0]].reshape((-1,2)), axis=1), axis=0)
    edges = edges[edges[:,0] != edges[:,1]]
    parents = list(range(len(counts)))
    def find(i):
        while i != parents[i]:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    kept = []
    for index in np.argsort(np.linalg.norm(centers[edges[:,1]]-centers[edges[:,0]], axis=1)):
        a, b = edges[index]
        x, y = find(a), find(b)
        if x != y:
            parents[y] = x
            kept.append([centers[a], centers[b]])
    if not kept:
        return short_segment(coords)
    merged = line_merge(MultiLineString(kept))
    lines = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]
    return [geographic(line.simplify(8).coords) for line in lines if line.length >= 15] or short_segment(coords)


def short_segment(coords):
    # Sub-cell alleys still have two real endpoints in their source geometry.
    a = coords[np.argmax(np.linalg.norm(coords - coords.mean(axis=0), axis=1))]
    b = coords[np.argmax(np.linalg.norm(coords - a, axis=1))]
    return [geographic([a, b])] if np.linalg.norm(b-a) >= 1 else []


roads = {road["name"]: road for road in catalog["roads"]}
features = []
for name, primitives in load_meshes("路网.glb"):
    if name not in roads:
        continue
    road = roads[name]
    lines = []
    for coords, indices in primitives:
        lines.extend(ribbon_lines(coords, indices))
    if not lines:
        continue
    # A village road is counted once, by its representative point on the longest path.
    line = max((LineString(points) for points in lines), key=lambda item: item.length)
    center = list(line.interpolate(.5, normalized=True).coords[0])
    road["point"] = [round(value, 5) for value in center]
    road["village"] = village_at(center, road["town"])
    features.append(dict(type="Feature", properties={key: road.get(key) for key in ("name","town","village","congestion")},
                         geometry=dict(type="MultiLineString", coordinates=lines)))
save("roads.geojson", dict(type="FeatureCollection", features=features))
save("catalog.json", catalog)
print(f"{len(features)} road geometries; {len(villages)} village boundaries; {len(catalog['waters'])} water sites")

hydrography = []
for name, primitives in load_meshes("水域.glb"):
    # Dissolve projected surface triangles so the display draws the shoreline,
    # including narrow river branches, without exposing the triangulation.
    triangles = np.concatenate([coords[indices.ravel()].reshape((-1, 3, 2)) for coords, indices in primitives])
    surface = union_all(polygons(triangles), grid_size=1).simplify(4)
    parts = surface.geoms if hasattr(surface, "geoms") else [surface]
    rings = [[geographic(ring.coords) for ring in [part.exterior, *part.interiors]]
             for part in parts if part.geom_type == "Polygon" and part.area > 5]
    if rings:
        hydrography.append(dict(type="Feature", properties={"name": name},
                                geometry=dict(type="MultiPolygon", coordinates=rings)))
save("waterways.geojson", dict(type="FeatureCollection", features=hydrography))
print(f"{len(hydrography)} water surfaces")

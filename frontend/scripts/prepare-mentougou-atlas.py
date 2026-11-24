"""Build the dashboard's georeferenced relief from the project's prepared GLB.

Requires Python 3, numpy, Pillow, and shapely. Run after the model and
geodata preparation scripts. No third-party basemap imagery is used.
"""
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely import make_valid, union_all
from shapely.geometry import MultiPolygon, box, mapping, shape


ROOT = Path(__file__).resolve().parents[1] / "public" / "maps"
SOURCE = ROOT / "local-model"
WEST, SOUTH, EAST, NORTH = 115.416805, 39.810992, 116.169245, 40.177916
WIDTH = 1536
MERCATOR_SPAN = np.log(np.tan(np.radians(45 + NORTH / 2)) / np.tan(np.radians(45 + SOUTH / 2)))
HEIGHT = round(WIDTH * np.degrees(MERCATOR_SPAN) / (EAST - WEST))


def read_model():
    raw = (SOURCE / "mentougou-hd.glb").read_bytes()
    length = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20 + length])
    binary = 28 + length

    def array(index):
        accessor = gltf["accessors"][index]
        view = gltf["bufferViews"][accessor["bufferView"]]
        kind = {5123: "<u2", 5125: "<u4", 5126: "<f4"}[accessor["componentType"]]
        dimensions = 3 if accessor["type"] == "VEC3" else 1
        offset = binary + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        return np.ndarray((accessor["count"], dimensions), dtype=kind, buffer=raw, offset=offset,
                          strides=(view.get("byteStride", np.dtype(kind).itemsize * dimensions), np.dtype(kind).itemsize))

    result = {}
    for node in gltf["nodes"]:
        primitive = gltf["meshes"][node["mesh"]]["primitives"][0]
        positions = array(primitive["attributes"]["POSITION"]) * np.array(node.get("scale", [1, 1, 1]))
        positions += node.get("translation", [0, 0, 0])
        result[node["name"]] = (positions, array(primitive["indices"]).reshape(-1, 3))
    return result


def render_atlas():
    meshes = read_model()
    terrain, triangles = meshes["terrain"]
    west, low, north = terrain.min(axis=0)
    east, _, south = terrain.max(axis=0)

    def project(points):
        x = (points[:, 0] - west) / (east - west)
        lat = NORTH - (points[:, 2] - north) / (south - north) * (NORTH - SOUTH)
        merc = lambda degrees: np.log(np.tan(np.radians(45 + degrees / 2)))
        y = (merc(NORTH) - merc(lat)) / (merc(NORTH) - merc(SOUTH))
        return np.column_stack((x * WIDTH, y * HEIGHT))

    vertices = np.column_stack((project(terrain), terrain[:, 1]))
    heights = np.full(HEIGHT * WIDTH, np.nan, dtype="float32")
    # Interpolate the actual surface at pixel centres. Skip walls and the base.
    for start in range(0, len(triangles), 2048):
        a, b, c = vertices[triangles[start:start + 2048]].transpose(1, 0, 2)
        det = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
        valid = (det < -0.000001) & (np.minimum.reduce([a[:, 2], b[:, 2], c[:, 2]]) > low + .9)
        if not valid.any():
            continue
        a, b, c, det = a[valid], b[valid], c[valid], det[valid]
        x0, y0 = np.maximum(np.floor(np.minimum.reduce([a[:, :2], b[:, :2], c[:, :2]])).astype(int), 0).T
        x1, y1 = np.minimum(np.ceil(np.maximum.reduce([a[:, :2], b[:, :2], c[:, :2]])).astype(int),
                            [WIDTH - 1, HEIGHT - 1]).T
        w = x1 - x0 + 1
        count = w * (y1 - y0 + 1)
        i = np.repeat(np.arange(len(w)), count)
        element = np.arange(len(i)) - np.repeat(np.cumsum(count) - count, count)
        x, y = x0[i] + element % w[i], y0[i] + element // w[i]
        dx, dy = x + .5 - a[i, 0], y + .5 - a[i, 1]
        u = (dx * (c[i, 1] - a[i, 1]) - dy * (c[i, 0] - a[i, 0])) / det[i]
        v = ((b[i, 0] - a[i, 0]) * dy - (b[i, 1] - a[i, 1]) * dx) / det[i]
        inside = (u >= 0) & (v >= 0) & (u + v <= 1)
        h = a[i, 2] + u * (b[i, 2] - a[i, 2]) + v * (c[i, 2] - a[i, 2])
        np.fmax.at(heights, (y * WIDTH + x)[inside], h[inside])
    heights = heights.reshape(HEIGHT, WIDTH)
    valid = np.isfinite(heights)
    if valid.sum() < WIDTH * HEIGHT * .3:
        raise ValueError("Insufficient terrain coverage")
    heights = np.nan_to_num(heights)
    dy, dx = np.gradient(heights, (south - north) / HEIGHT, (east - west) / WIDTH)
    shading = (.8 + dx * .95 + dy * .62) / np.sqrt(1 + dx ** 2 + dy ** 2)
    palette = [(0, (32, 68, 82)), (350, (36, 86, 97)), (800, (49, 100, 110)),
               (1400, (78, 118, 124)), (2200, (123, 147, 148))]
    colors = np.stack([np.interp(heights, [h for h, _ in palette], [c[k] for _, c in palette])
                       for k in range(3)], axis=-1)
    minor = np.maximum(0, 1 - np.abs((heights + 45) % 90 - 45) / 5)
    rgb = np.clip(colors * (.52 + .60 * shading[:, :, None]) + minor[:, :, None] * 9, 0, 255)
    rgba = np.dstack((rgb.astype("uint8"), valid.astype("uint8") * 255))
    image = Image.fromarray(rgba)
    draw = ImageDraw.Draw(image)
    for name, color in [("roads", (152, 146, 106, 255)), ("water", (78, 173, 197, 255))]:
        points, faces = meshes[name]
        footprint = np.rint(project(points)).astype("int32")
        for face in footprint[faces]:
            draw.polygon([tuple(vertex) for vertex in face], fill=color)
    image.save(ROOT / "district-relief.webp", quality=92, method=6)
    # The mesh has no elevations beyond the district cut. Extend its edge for a
    # short transition so draping imagery does not create an artificial cliff.
    pad = 64
    extended = np.pad(heights, pad)
    known = np.pad(valid, pad)
    distance = np.zeros_like(extended)
    for step in range(1, pad + 1):
        values = np.zeros_like(extended)
        neighbors = np.zeros_like(extended, dtype="uint8")
        for shift, axis in [(1, 0), (-1, 0), (1, 1), (-1, 1)]:
            values += np.roll(extended, shift, axis)
            neighbors += np.roll(known, shift, axis)
        edge = (~known) & (neighbors > 0)
        extended[edge] = values[edge] / neighbors[edge]
        known |= edge
        distance[edge] = step
    softened = extended * (.5 + .5 * np.cos(np.pi * distance / pad))
    # Two lossless channels encode whole metres above the model's vertical datum.
    meters = np.maximum(softened, 0).round().astype("uint16")
    Image.fromarray(np.stack((meters >> 8, meters & 255, np.zeros_like(meters)), -1).astype("uint8")).save(
        ROOT / "district-elevation.png", optimize=True)


def build_boundaries():
    raw = json.loads((SOURCE / "data" / "towns.geojson").read_text(encoding="utf-8"))
    shapes = [make_valid(shape(feature["geometry"])) for feature in raw["features"]]
    district = union_all(shapes, grid_size=.000001).simplify(.00003)
    # Use a real geometric difference, preserving islands and holes at every zoom.
    exterior = box(108, 34, 124, 46).difference(district)

    def feature(geometry, **properties):
        return dict(type="Feature", properties=properties, geometry=mapping(geometry))

    def polygons(geometry):
        if geometry.geom_type == "Polygon":
            yield geometry
        elif geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
            for child in geometry.geoms:
                yield from polygons(child)

    features = [feature(exterior, kind="outside"), feature(district, kind="district")]
    for original, geom in zip(raw["features"], shapes, strict=True):
        clean = geom.simplify(.000055)
        if clean.geom_type == "GeometryCollection":
            clean = MultiPolygon(list(polygons(clean)))
        if clean.is_empty:
            raise ValueError("Empty town boundary")
        features.append(feature(clean, kind="town", name=original["properties"]["name"],
                                code=original["properties"]["code"]))
    data = json.dumps(dict(type="FeatureCollection", features=features), ensure_ascii=False, separators=(",", ":"))
    (ROOT / "district-atlas.geojson").write_text(data, encoding="utf-8")


if __name__ == "__main__":
    build_boundaries()
    render_atlas()

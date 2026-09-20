import { ExtrudeGeometry } from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ixdMark } from "./ixd-mark";

/** Replace the legacy moulded lettering at its original cover location.
 * The IXD paths are shared with the UI; no external font or model rebuild is
 * needed. The original shell, part groups and physical materials stay intact.
 */
export function ixdInscriptionGeometry() {
  // Only path geometry is used; the cover supplies its physical material.
  const svg = ixdMark("ixd-inscription").replace(/url\(#[^)]+\)/g, "#ffffff");
  const paths = new SVGLoader().parse(svg).paths
    .filter(path => path.userData?.node.hasAttribute("data-letter"));
  const parts = paths.flatMap(path => SVGLoader.createShapes(path).map(shape =>
    new ExtrudeGeometry(shape, { depth: 6, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 1, steps: 1, curveSegments: 12 }),
  ));
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  geometry.translate(-bounds.min.x, -bounds.max.y, 0);
  geometry.scale(.001, -.001, .001);
  geometry.rotateZ(-Math.PI / 2);
  geometry.translate(-2.27, 2.29, .156);
  return geometry;
}

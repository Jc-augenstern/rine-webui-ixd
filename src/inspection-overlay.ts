import {
  SCAN_FROM,
  SCAN_TO,
  SCAN_CORNERS,
  type DecryptionFrame,
} from "./decryption";

export function inspectionSegments(frame: DecryptionFrame) {
  const point = (t: number): [number, number] => [
    SCAN_FROM[0] + (SCAN_TO[0] - SCAN_FROM[0]) * t,
    SCAN_FROM[1] + (SCAN_TO[1] - SCAN_FROM[1]) * t,
  ];
  return frame.intervals.map(([a, b]) => [point(a), point(b)] as const);
}

export class InspectionOverlay {
  private root = document.querySelector<SVGSVGElement>("#inspection-marks")!;
  private line = this.root.querySelector<SVGPathElement>("#inspection-lines")!;
  private corners = this.root.querySelector<SVGGElement>(
    "#inspection-corners",
  )!;
  private point =
    this.root.querySelector<SVGCircleElement>("#inspection-point")!;
  private label = document.querySelector<HTMLElement>("#inspection-text")!;
  private labelValue = this.label.querySelector<HTMLElement>("strong")!;
  private host = document.querySelector<HTMLElement>("#three-scene")!;
  private cornerRects = SCAN_CORNERS.map(() => {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", "8");
    rect.setAttribute("height", "8");
    this.corners.append(rect);
    return rect;
  });

  private attribute(node: Element, name: string, value: string) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  private opacity(node: HTMLElement | SVGElement, value: number) {
    const text = String(value);
    if (node.style.opacity !== text) node.style.opacity = text;
  }

  render(
    frame: DecryptionFrame,
    projection: {
      prepare(width: number, height: number): void;
      point(x: number, y: number): readonly [number, number];
    },
    showLabel: boolean,
  ) {
    const visible = Boolean(frame.intervals.length || frame.markers > 0 || frame.point > 0);
    this.opacity(this.root, Number(visible));
    this.attribute(this.root, "data-phase", frame.phase);
    this.attribute(this.root, "data-reference-time", frame.time.toFixed(3));
    this.opacity(this.label, showLabel ? frame.label : 0);
    this.opacity(this.labelValue, frame.labelValue);
    this.opacity(this.corners, frame.markers);
    this.opacity(this.point, frame.point);
    if (!visible) {
      this.attribute(this.line, "d", "");
      return;
    }

    // Invisible overlays do no layout reads or 3D projection. For visible
    // marks, update the model matrix and read the viewport only once per frame.
    const width = this.host.clientWidth, height = this.host.clientHeight;
    this.attribute(this.root, "viewBox", `0 0 ${width} ${height}`);
    projection.prepare(width, height);
    this.attribute(this.line, "d", inspectionSegments(frame)
      .map(([a, b]) => `M${projection.point(...a)}L${projection.point(...b)}`).join(""));
    if (frame.markers > 0) SCAN_CORNERS.forEach(([x, y], i) => {
      const [px, py] = projection.point(x, y);
      this.attribute(this.cornerRects[i], "x", String(px - 4));
      this.attribute(this.cornerRects[i], "y", String(py - 4));
    });
    if (frame.point > 0) {
      const [cx, cy] = projection.point((SCAN_FROM[0] + SCAN_TO[0]) / 2, (SCAN_FROM[1] + SCAN_TO[1]) / 2);
      this.attribute(this.point, "cx", String(cx));
      this.attribute(this.point, "cy", String(cy));
    }
  }
}

import { ixdMark } from "./ixd-mark";
// One shared IXD mark for the opening and printed archive label.
export const labelMarkSvg = ixdMark("ixd-label");
const analysisPositions = [2, 28, 55, 81, 103, 129, 154, 166];
export const brandHeading = `<h1>IXD</h1><div>INTERACTION &amp; DESIGN</div><p><span class="brand-analysis" role="img" aria-label="ANALYSIS">${[..."ANALYSIS"].map((letter, i) => `<span aria-hidden="true" style="left:${analysisPositions[i]}px">${letter}</span>`).join("")}</span> <b>OS</b></p>`;

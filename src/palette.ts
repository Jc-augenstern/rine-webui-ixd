/** IXD's shared UI / scene palette. Pairs are light and dark endpoints. */
export const palette = {
  paper: ['#eef2f8', '#111722'],
  panel: ['#f8faff', '#1b2434'],
  field: ['#e5ebf5', '#253149'],
  ink: ['#1c2638', '#e8edf7'],
  muted: ['#5b687e', '#a5b2c8'],
  line: ['#c4cddd', '#44526c'],
  accent: ['#5657ce', '#a3a2ff'],
  onAccent: ['#ffffff', '#111722'],
  cyan: ['#55c5d1', '#55dce0'],
} as const;

export const scenePalette = {
  floor: ['#d5dfed', '#182237'],
  mist: [palette.paper[0], '#27334b'],
  sky: '#f5f9ff', groundLight: '#a1b1cb', keyLight: '#f4f8ff',
  glass: '#f8fbff', attenuation: '#e2eaf7', arrayAttenuation: '#becfe6',
  ceramic: '#bcc8d9', edge: '#e5ecf7', diffuser: '#d7e1ef',
  optics: '#a6b6cd', opticalEdge: '#cedbed', arrayGlass: '#f3f8ff',
  arrayDiffuser: '#576b88', arrayEdge: '#eaf1fb', arrayIndex: '#a4b2e0',
  index: '#7e7bf7', internalAccent: palette.cyan[0], fastener: '#b6c2d3',
  // Linear RGB shader tints, shared by array and extracted glass.
  glassShade: 'vec3(0.22, 0.28, 0.40)', glassHighlight: 'vec3(0.94, 0.97, 1.0)',
} as const;

export const darkSurfaces: Record<string, string> = {
  Frosted_Polymer: '#65738d', Ivory_Edges: '#6c7c98', Optical_Diffuser: '#1a263b',
  Titanium_Fasteners: '#b5c3dc', Index_Inlay: palette.accent[1], Printed_Label: palette.field[1],
  Subsurface_Optics: '#97aac6', Optical_Edges: '#b6c8e2', Carbon_Ink: palette.ink[1],
  Amber_Optical_Inlay: palette.cyan[1], Champagne_Index: palette.accent[1],
  Internal_Ceramic: '#879ab7', Optical_Film: '#a6bbd9', Optical_Film_Edge: '#617592',
  Case_Engraving: '#60718b', Case_Engraving_Highlight: '#a5b7d3', Moulded_Lettering: '#93a6c3',
};

/** Override warm colors embedded in the GLB without changing its geometry. */
export const lightSurfaces: Record<string, string> = {
  Frosted_Polymer: scenePalette.glass, Ivory_Edges: scenePalette.edge,
  Optical_Diffuser: scenePalette.diffuser, Titanium_Fasteners: scenePalette.fastener,
  Index_Inlay: scenePalette.index, Printed_Label: palette.field[0],
  Subsurface_Optics: scenePalette.optics, Optical_Edges: scenePalette.opticalEdge,
  Carbon_Ink: palette.ink[0], Internal_Ceramic: scenePalette.ceramic,
  Amber_Optical_Inlay: scenePalette.internalAccent, Champagne_Index: scenePalette.index,
  Optical_Film: '#cbd9eb', Optical_Film_Edge: '#90a5c2', Case_Engraving: '#879bb8',
  Case_Engraving_Highlight: '#dfebfa', Moulded_Lettering: '#c4d1e5',
};

export const opticalSurfaces: Record<string, string> = {
  Optical_Glass_Body: '#929fb6', Optical_Glass_Roof: '#93a3bd',
  Optical_Glass_Edge: '#e7efff', Optical_Bridge_Glass: '#a0b5cb',
};

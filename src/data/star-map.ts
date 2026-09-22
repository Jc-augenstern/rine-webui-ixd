import { clubContent, type ClubContent } from "./club-content";

export interface StarPosition { x: number; y: number }
export type StarType = "direction" | "function" | "unexplored";

/** Structure is an editorial choice; the seed only arranges its small star dust. */
export type GalaxyVisualPreset =
  | "neural-cluster" | "binary-mechanism" | "echo-nebula" | "asymmetric-arms"
  | "spatial-gate" | "lattice-satellites" | "ixd-core" | "protostar-shell"
  | "ascent-comet" | "exchange-stars" | "prism-shards" | "open-beacon"
  | "dormant-arc" | "dormant-pair" | "dormant-shard";
export type GalaxyMotionPreset =
  | "network-spread" | "joint-unfold" | "echo-expand" | "arm-bloom"
  | "ring-depth" | "signal-route" | "core-align" | "shell-open"
  | "comet-rise" | "exchange-pulse" | "prism-fan" | "beacon-guide" | "dormant";
export interface StarVisualIdentity {
  visualPreset: GalaxyVisualPreset;
  motionPreset: GalaxyMotionPreset;
  visualSeed: number;
}

const nodeVisuals = {
  ai: { visualPreset: "neural-cluster", motionPreset: "network-spread", visualSeed: 1101 },
  robotics: { visualPreset: "binary-mechanism", motionPreset: "joint-unfold", visualSeed: 2202 },
  interaction: { visualPreset: "echo-nebula", motionPreset: "echo-expand", visualSeed: 3303 },
  visual: { visualPreset: "asymmetric-arms", motionPreset: "arm-bloom", visualSeed: 4404 },
  xr: { visualPreset: "spatial-gate", motionPreset: "ring-depth", visualSeed: 5505 },
  hardware: { visualPreset: "lattice-satellites", motionPreset: "signal-route", visualSeed: 6606 },
  core: { visualPreset: "ixd-core", motionPreset: "core-align", visualSeed: 7707 },
  project: { visualPreset: "protostar-shell", motionPreset: "shell-open", visualSeed: 8808 },
  competition: { visualPreset: "ascent-comet", motionPreset: "comet-rise", visualSeed: 9909 },
  salon: { visualPreset: "exchange-stars", motionPreset: "exchange-pulse", visualSeed: 1010 },
  portfolio: { visualPreset: "prism-shards", motionPreset: "prism-fan", visualSeed: 1111 },
  join: { visualPreset: "open-beacon", motionPreset: "beacon-guide", visualSeed: 1212 },
} as const satisfies Record<string, StarVisualIdentity>;

/** Positions are normalized within the star field. Add one record to add a star. */
export interface StarMapNode extends StarVisualIdentity {
  id: string;
  type: StarType;
  title: string;
  subtitle: string;
  position: StarPosition;
  mobilePosition?: StarPosition;
  enabled: boolean;
  brightness: number;
  content: ClubContent | null;
  route: string | null;
  number?: string;
  color?: string;
}

export const starMap: readonly StarMapNode[] = [
  { ...nodeVisuals.ai, id: "ai", type: "direction", number: "01", title: "AI 与智能系统", subtitle: "让智能成为可体验的产品", position: { x: .59, y: .20 }, mobilePosition: { x: .27, y: .20 }, enabled: true, brightness: 1, color: "#a496fb", content: clubContent.ai, route: "#star/ai" },
  { ...nodeVisuals.robotics, id: "robotics", type: "direction", number: "02", title: "具身智能与机器人", subtitle: "感知、动作与人机协作", position: { x: .79, y: .40 }, mobilePosition: { x: .71, y: .30 }, enabled: true, brightness: .95, color: "#7eb8f5", content: clubContent.robotics, route: "#star/robotics" },
  { ...nodeVisuals.interaction, id: "interaction", type: "direction", number: "03", title: "新媒体与交互设计", subtitle: "交互体验与数字表达", position: { x: .48, y: .51 }, mobilePosition: { x: .28, y: .40 }, enabled: true, brightness: 1, color: "#92baf9", content: clubContent.interaction, route: "#star/interaction" },
  { ...nodeVisuals.visual, id: "visual", type: "direction", number: "04", title: "文创与视觉设计", subtitle: "文化、视觉与产品化表达", position: { x: .23, y: .64 }, mobilePosition: { x: .29, y: .56 }, enabled: true, brightness: .9, color: "#b3a1ee", content: clubContent.visual, route: "#star/visual" },
  { ...nodeVisuals.xr, id: "xr", type: "direction", number: "05", title: "XR 与交互娱乐", subtitle: "实时交互与沉浸体验", position: { x: .67, y: .72 }, mobilePosition: { x: .27, y: .70 }, enabled: true, brightness: .95, color: "#90bdfc", content: clubContent.xr, route: "#star/xr" },
  { ...nodeVisuals.hardware, id: "hardware", type: "direction", number: "06", title: "智能硬件", subtitle: "连接数字与真实世界", position: { x: .88, y: .75 }, mobilePosition: { x: .28, y: .86 }, enabled: true, brightness: .9, color: "#79d3de", content: clubContent.hardware, route: "#star/hardware" },
  { ...nodeVisuals.core, id: "core", type: "function", title: "社团介绍", subtitle: "IXD CORE", position: { x: .10, y: .43 }, mobilePosition: { x: .19, y: .035 }, enabled: true, brightness: .6, content: clubContent.core, route: "#star/core" },
  { ...nodeVisuals.project, id: "project", type: "function", title: "项目孵化", subtitle: "PROJECT", position: { x: .40, y: .30 }, mobilePosition: { x: .73, y: .10 }, enabled: true, brightness: .6, content: clubContent.project, route: "#star/project" },
  { ...nodeVisuals.competition, id: "competition", type: "function", title: "竞赛星系", subtitle: "COMPETITION", position: { x: .88, y: .12 }, mobilePosition: { x: .78, y: .465 }, enabled: true, brightness: .65, content: clubContent.competition, route: "#star/competition" },
  { ...nodeVisuals.salon, id: "salon", type: "function", title: "沙龙交流", subtitle: "SALON", position: { x: .40, y: .84 }, mobilePosition: { x: .73, y: .625 }, enabled: true, brightness: .55, content: clubContent.salon, route: "#star/salon" },
  { ...nodeVisuals.portfolio, id: "portfolio", type: "function", title: "作品集", subtitle: "PORTFOLIO", position: { x: .70, y: .91 }, mobilePosition: { x: .73, y: .785 }, enabled: true, brightness: .55, content: clubContent.portfolio, route: "#star/portfolio" },
  { ...nodeVisuals.join, id: "join", type: "function", title: "加入我们", subtitle: "JOIN IXD", position: { x: .09, y: .85 }, mobilePosition: { x: .73, y: .965 }, enabled: true, brightness: .7, content: clubContent.join, route: "#star/join" },
  ...[
    [.46, .06], [.95, .44], [.58, .88], [.05, .65], [.29, .46], [.70, .08],
  ].map(([x, y], index): StarMapNode => ({
    id: `unexplored-${index + 1}`, type: "unexplored", title: "等待下一次探索", subtitle: "UNEXPLORED", position: { x, y },
    mobilePosition: { x: index % 2 === 0 ? .08 : .91, y: .16 + index * .15 },
    enabled: false, brightness: .2, content: null, route: null,
    visualPreset: (["dormant-arc", "dormant-pair", "dormant-shard"] as const)[index % 3],
    motionPreset: "dormant", visualSeed: 1300 + index,
  })),
];

export const constellationLinks: readonly (readonly [string, string])[] = [
  ["ai", "robotics"], ["robotics", "hardware"], ["hardware", "xr"],
  ["xr", "interaction"], ["interaction", "visual"], ["interaction", "ai"],
];

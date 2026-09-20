/** Content transcribed from the user's IXD社团.docx (筹建架构方案 / 初稿).
 * Typical projects are learning examples, never completed-work or award claims.
 */
export interface ClubSection {
  title: string;
  body?: string;
  items?: readonly string[];
}

export interface CompetitionNode {
  title: string;
  description: string;
}

export interface ClubContent {
  eyebrow: string;
  summary: string;
  sections: readonly ClubSection[];
  keywords?: readonly string[];
  projects?: readonly string[];
  competitions?: readonly CompetitionNode[];
  notice?: string;
}

export const contentSource = "依据《IXD 社团架构方案》初稿 · 社团筹建规划";

export const clubContent: Record<string, ClubContent> = {
  ai: {
    eyebrow: "AI & INTELLIGENT SYSTEMS",
    summary: "AI 技术如何转化为可用、可体验、可展示的智能交互产品。",
    keywords: ["AIGC", "大语言模型", "AI Agent", "多模态交互", "图像 / 视频生成", "AI 应用开发", "数字人", "AI 辅助创作"],
    projects: ["AI 学习助手", "AI 桌宠", "AI 数字人", "智能导览", "AI 情绪交互", "设计辅助工具"],
    sections: [],
  },
  robotics: {
    eyebrow: "EMBODIED INTELLIGENCE & ROBOTICS",
    summary: "AI + 硬件 + 交互，关注真实环境中的感知、动作与人机协作。",
    keywords: ["ROS2", "Arduino", "ESP32", "Raspberry Pi", "传感器", "计算机视觉", "语音交互", "机器人结构与控制"],
    projects: ["服务机器人", "环保机器人", "智能交互装置", "视觉识别终端", "实体 AI 助手"],
    sections: [],
  },
  interaction: {
    eyebrow: "NEW MEDIA & INTERACTION DESIGN",
    summary: "作为社团的交互体验与数字表达能力中心，而不是“宣传部”。",
    keywords: ["UI / UX", "交互设计", "动态设计", "信息可视化", "数字影像", "网页交互", "TouchDesigner", "Processing", "数字展陈"],
    projects: ["数据可视化系统", "互动网页", "展览交互", "机器人控制界面", "项目演示与动效"],
    sections: [],
  },
  visual: {
    eyebrow: "CULTURE & VISUAL DESIGN",
    summary: "面向文化内容、视觉系统和产品化表达，适配设计类与文旅类竞赛。",
    keywords: ["IP 设计", "品牌视觉", "文创产品", "插画", "包装", "校园文化", "地方文化", "非遗数字化", "AI + 文创"],
    projects: ["地方文化 IP", "非遗智能导览", "校园文创", "数字文旅视觉系统", "AI 生成式文创"],
    sections: [],
  },
  xr: {
    eyebrow: "XR & INTERACTIVE ENTERTAINMENT",
    summary: "以 XR 和实时交互技术为核心，“游戏”作为重要应用而非唯一方向。",
    keywords: ["VR / AR / MR", "Unity", "Unreal Engine", "游戏设计", "3D 建模", "虚拟场景", "虚拟人", "交互叙事"],
    projects: ["VR 展览", "数字博物馆", "交互游戏", "AI NPC", "虚拟场景与沉浸式体验"],
    sections: [],
  },
  hardware: {
    eyebrow: "INTELLIGENT HARDWARE",
    summary: "以智能硬件与软硬件协同为核心，面向实际场景开展创新设计与应用开发。",
    keywords: ["嵌入式系统", "Arduino", "树莓派", "传感器技术", "物联网", "单片机", "机器人", "智能交互", "3D 建模与打印", "机械结构设计", "人工智能"],
    projects: ["智能家居设备", "可穿戴设备", "交互式装置", "校园智能设施", "辅助学习与生活的创新硬件产品"],
    sections: [],
  },
  core: {
    eyebrow: "IXD CORE",
    summary: "一片由不同兴趣交汇而成的星空。以智能交互设计专业新生为主，在项目中学习，在协作中探索。",
    sections: [
      { title: "共同的目标", body: "沙龙宣讲、比赛参与、项目孵化与作品集沉淀。少层级、强项目、重传承，鼓励跨方向协作。" },
      { title: "选择主方向，保持开放", body: "每个团队建议选择一个主方向，同时可以参与其他方向的项目。方向负责人承担学习路径组织、资源整理、经验分享和项目招募。" },
      { title: "一起组织与支持", items: ["指导老师与学生指导提供支持。", "社团负责人对接老师，统筹日常与比赛信息。", "六个方向负责人辅导社员根据方向参赛。", "沙龙负责人统筹日常活动的举办与对接。"] },
    ],
    notice: "目前展示的是筹建方案。原稿建议规模约 50 人，并非现有成员统计。",
  },
  project: {
    eyebrow: "PROJECT INCUBATION",
    summary: "让一个想法，逐步成为可体验、可展示的作品。以学年为周期，在真实项目中推进学习与协作。",
    sections: [
      { title: "从兴趣出发", body: "招新后统一培训，按兴趣选择项目方向、组建参赛团队，参加新生创意赛校级比赛；各方向负责人提供项目指导。" },
      { title: "重点孵化", body: "校赛结束后，综合项目质量、比赛成绩、发展潜力及团队协作情况，每个方向择优选取 1–2 个项目进入重点孵化；依据项目需要进一步调整成员。" },
      { title: "持续支持", items: ["入选项目：项目打磨、技术支持、材料修改、赛事申报与后续参赛指导。", "其他社员：持续获得比赛信息与参与机会，可自主组队，也可参与后续项目成员选拔。"] },
    ],
    notice: "这里说明的是计划中的孵化机制，暂未提供已完成项目档案。",
  },
  competition: {
    eyebrow: "COMPETITION ORBITS",
    summary: "把学习带入实践。从选题到答辩，在不同赛事方向中找到项目的下一站。",
    sections: [
      { title: "从构想到呈现", body: "指导老师、方向负责人及核心社员共同提供赛事信息、选题策划、方案设计、技术实现、作品制作、材料撰写、答辩展示与赛后总结指导。成员可根据兴趣与能力组队，也可跨方向协作。" },
    ],
    competitions: [
      { title: "世界人形机器人运动会", description: "机器人设计、制作、编程及竞赛训练。" },
      { title: "中国国际大学生创新大赛及相关工创类竞赛", description: "项目策划、产品设计、创新实践和团队协作。原稿列名：中国国际“互联网+”大学生创新创业大赛及相关工创类竞赛。" },
      { title: "全国大学生计算机设计大赛", description: "程序设计、数字媒体、人工智能与信息系统方向的项目指导。" },
      { title: "全国大学生机械创新设计大赛", description: "设计、建模、加工制作和功能验证。" },
      { title: "米兰设计周", description: "产品设计、工业设计、视觉设计及创新方案展示。" },
      { title: "未来设计师大赛", description: "数字艺术、产品设计、视觉传达与环境设计的创意设计和作品打磨。" },
    ],
    notice: "这些是方案中的辅导赛事方向，不代表参赛或获奖记录。赛事安排与报名信息待发布。",
  },
  salon: {
    eyebrow: "KNOWLEDGE EXCHANGE",
    summary: "把经验传递给下一位探索者。通过主题沙龙和交流活动，连接新成员、核心社员与毕业学长。",
    sections: [
      { title: "分享的内容", items: ["竞赛经验与项目案例", "专业技能交流与作品展示", "升学、就业经验分享"] },
      { title: "一起交流", body: "计划由指导老师、核心社员及毕业学长共同举办不定期活动，帮助成员了解赛事要求、掌握实践方法、拓展专业视野，促进新老成员之间的传承与合作。" },
    ],
    notice: "具体活动时间、地点与分享者尚未发布。",
  },
  portfolio: {
    eyebrow: "WORK IN PROGRESS",
    summary: "把探索留下来。作品集沉淀是社团培养目标之一，让项目过程与学习成果成为下一次出发的基础。",
    sections: [
      { title: "从项目走向作品集", body: "完成项目、参与比赛并形成作品集，是原方案的最终培养路径。沙龙也将为作品展示与交流提供机会。" },
      { title: "等待第一份作品", body: "现有资料暂未提供作品名称、作者或作品链接。未来真实作品将在这里逐步归档。" },
    ],
    notice: "各专业方向中的“典型项目”是学习与选题示例，不是已完成的社团作品。",
  },
  join: {
    eyebrow: "JOIN IXD",
    summary: "你的兴趣，可以成为这片星空的新坐标。先探索一个方向，再与伙伴一起把想法付诸实践。",
    sections: [
      { title: "面向新生", body: "方案计划每年 9 月集中招新，以智能交互设计专业新生为重点，同时欢迎其他专业新生。原则上不设置选拔门槛和人数上限；为保障资源向新生倾斜，原则上不面向高年级学生招新。" },
      { title: "加入之后", body: "统一培训 → 按兴趣选择方向 → 组建团队 → 参加新生创意赛校级比赛 → 持续项目指导。" },
      { title: "先找到感兴趣的方向", body: "返回星图，探索六颗专业方向主星，了解各方向的学习关键词与典型项目。" },
    ],
    notice: "报名渠道、联系人和招新安排待发布。当前页面不接收报名。",
  },
};

/** This track reflects browsing the plan, not a member's actual study progress. */
export const growthSteps = [
  { id: "understand", title: "了解专业", relatedStar: "core", description: "从了解智能交互设计能做什么开始，通过社团介绍、统一培训、沙龙与经验交流，认识不同的实践方向。" },
  { id: "choose", title: "选择方向", relatedStar: "ai", description: "根据自身兴趣和能力选择主方向。主方向提供学习路径与项目支持，同时保持参与其他方向项目的可能。" },
  { id: "create", title: "完成项目", relatedStar: "project", description: "组建团队，从选题策划、方案设计到技术实现和作品制作，在项目中学习协作。" },
  { id: "compete", title: "参与比赛", relatedStar: "competition", description: "在老师与方向负责人的指导下，准备材料与答辩展示，参与相应赛事，并进行赛后总结。" },
  { id: "collect", title: "形成作品集", relatedStar: "portfolio", description: "将学习与项目成果沉淀为作品集，在作品展示与交流中继续打磨。" },
  { id: "pass-on", title: "带领新成员", relatedStar: "salon", description: "下一学年带领新成员，把项目经验、专业技能与实践方法传递下去。培养机制以学年为周期循环。" },
] as const;

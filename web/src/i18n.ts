export const locale = "zh" as const

export const copy = {
  zh: {
    appName: "Butler",
    appTagline: "房产中介的 AI 看房排期助理",
    clientPlans: "客户计划",
    viewingRoute: "看房线路",
    property: "房源",
    aiScheduling: "AI 排期",
    messages: "中介沟通",
    settings: "AI 规则",
  },
} as const

export function t(key: keyof typeof copy.zh) {
  return copy[locale][key]
}

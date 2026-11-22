export const tabElementIds = (strip: string, at: number): { tab: string; panel: string } => ({
  tab: `${strip}-tab-${String(at)}`,
  panel: `${strip}-panel-${String(at)}`,
});

/** Public reporting hierarchy is independent of fitted indices and tracking IDs. */
export const profileOrder = [
  "Champions", "High-Value Regulars", "Loyalists", "Valuable Customers at Risk",
  "Mid-Tier Occasionals", "Occasional Buyers at Risk", "Light Buyers", "Light Buyers at Risk",
  "Hibernating / Lost",
];
const legacyNames: Record<string, string> = {
  "Champions at Risk": "Valuable Customers at Risk", "Loyalist at Risk": "Valuable Customers at Risk",
  "Mid-Tier Occasional": "Mid-Tier Occasionals", "Occasional at Risk": "Occasional Buyers at Risk",
  Developing: "Light Buyers", "Developing at Risk": "Light Buyers at Risk",
};
export const baseProfile = (name: unknown): string => {
  const text = String(name ?? "");
  if (text.startsWith("Champions · ")) return "High-Value Regulars";
  const base = text.split(" · ")[0];
  return legacyNames[base] ?? base;
};
export const profileRank = (name: unknown): number => {
  const index = profileOrder.indexOf(baseProfile(name));
  return index < 0 ? profileOrder.length : index;
};
/** Expression is a source-defined SQL column, never user input. */
export const profileOrderSql = (expression: string): string => `CASE ${profileOrder.map((name, index) => {
  const names = [name, ...Object.entries(legacyNames).filter(([, value]) => value === name).map(([old]) => old)];
  const conditions = names.map(value => `${expression} = '${value}' OR ${expression} LIKE '${value} · %'`);
  if (name === "High-Value Regulars") conditions.push(`${expression} LIKE 'Champions · %'`);
  return `WHEN ${conditions.join(" OR ")} THEN ${index}`;
}).join(" ")} ELSE ${profileOrder.length} END`;

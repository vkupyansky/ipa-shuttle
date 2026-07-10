export function shortUdid(udid: string) {
  if (udid.length <= 12) {
    return udid;
  }
  return `${udid.slice(0, 6)}...${udid.slice(-6)}`;
}

export function initials(value: string) {
  const parts = value
    .replace(/[._-]+/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "—"
  );
}

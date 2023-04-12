export function get() {
  const root: any = {
    "m.homeserver": { base_url: "https://matrix.franchb.com:8448" },
  };
  return {
    body: JSON.stringify(root),
  };
}

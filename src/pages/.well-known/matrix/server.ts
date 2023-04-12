export function get() {
  const root: any = { "m.server": "matrix.franchb.com:8448" };
  return {
    body: JSON.stringify(root),
  };
}

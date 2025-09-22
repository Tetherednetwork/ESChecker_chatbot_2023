// types/whois-json.d.ts
declare module "whois-json" {
  // Minimal typing that matches how you use it
  function whois(domain: string, opts?: Record<string, any>): Promise<any>;
  export default whois;
}

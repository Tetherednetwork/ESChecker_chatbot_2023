// types/psl.d.ts
declare module "psl" {
  export interface Parsed {
    tld: string | null;
    sld: string | null;
    domain: string | null;
    subdomain: string | null;
    listed: boolean;
  }
  export function parse(domain: string): Parsed;
  export function get(domain: string): string | null;
  export function isValid(domain: string): boolean;
}

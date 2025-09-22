// types/validator.d.ts
declare module "validator" {
  export function isEmail(s: string, options?: any): boolean;
  export function isFQDN(s: string, options?: any): boolean;
  export function isIP(s: string, version?: number | "4" | "6"): boolean;
  export function isURL(s: string, options?: any): boolean;

  const _default: {
    isEmail: typeof isEmail;
    isFQDN: typeof isFQDN;
    isIP: typeof isIP;
    isURL: typeof isURL;
  };
  export default _default;
}

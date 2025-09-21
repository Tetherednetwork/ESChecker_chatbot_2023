// types/msgreader.d.ts
declare module "msgreader" {
  export default class MSGReader {
    constructor(buffer: Uint8Array);
    getFileData(): {
      subject?: string;
      senderEmail?: string;
      body?: string;
      bodyHTML?: string;
      [key: string]: unknown;
    };
  }
}

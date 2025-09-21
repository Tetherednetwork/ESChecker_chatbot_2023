// pages/_document.tsx
import { Html, Head, Main, NextScript } from "next/document";
<link rel="manifest" href="/site.webmanifest?v=1" />
export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#0b1220" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

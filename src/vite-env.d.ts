/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module '*?raw' {
  const content: string;
  export default content;
}

interface Window {
  lastFrameLogTime?: number;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

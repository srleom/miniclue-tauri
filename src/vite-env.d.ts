/// <reference types="vite/client" />

// Declare module for Vite's ?url suffix imports
declare module '*?url' {
  const url: string;
  export default url;
}

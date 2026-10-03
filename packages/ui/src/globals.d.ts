/// <reference types="next/image-types/global" />

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

/*
 * Prism 语言组件是**裸 JS 文件、无类型声明**（@types/prismjs 只覆盖核心）。
 * 它们只被动态 import、返回值不用（副作用是给全局 Prism 注册语法），
 * 显式声明成 any 比 TS7016 报错诚实。
 */
declare module "prismjs/components/prism-typescript";
declare module "prismjs/components/prism-jsx";
declare module "prismjs/components/prism-tsx";
declare module "prismjs/components/prism-json";
declare module "prismjs/components/prism-bash";
declare module "prismjs/components/prism-python";
declare module "prismjs/components/prism-yaml";
declare module "prismjs/components/prism-sql";
declare module "prismjs/components/prism-markdown";
declare module "prismjs/components/prism-go";
declare module "prismjs/components/prism-rust";
declare module "prismjs/components/prism-java";
declare module "prismjs/components/prism-c";
declare module "prismjs/components/prism-cpp";
declare module "prismjs/components/prism-csharp";
declare module "prismjs/components/prism-diff";
declare module "prismjs/components/prism-toml";
declare module "prismjs/components/prism-docker";

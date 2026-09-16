declare module "bpmn-js/lib/Modeler" {
  const Modeler: new (options: Record<string, unknown>) => {
    importXML(xml: string): Promise<{ warnings: unknown[] }>;
    saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
    get<T = unknown>(name: string): T;
    on(event: string, cb: (e: unknown) => void): void;
    destroy(): void;
  };
  export default Modeler;
}
declare module "bpmn-js-token-simulation" {
  const mod: unknown;
  export default mod;
}
declare module "bpmn-js/lib/NavigatedViewer" {
  const Viewer: new (options: Record<string, unknown>) => {
    importXML(xml: string): Promise<{ warnings: unknown[] }>;
    get<T = unknown>(name: string): T;
    destroy(): void;
  };
  export default Viewer;
}

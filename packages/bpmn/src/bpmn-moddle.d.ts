/**
 * bpmn-moddle 10 은 "." 진입점에 타입을 제공하지 않는다 ("./types" 만 있음). 파서가 쓰는 부분만 선언한다.
 */
declare module "bpmn-moddle" {
  export interface ModdleElement {
    $type: string;
    id?: string;
    name?: string;
    get(name: string): unknown;
    [key: string]: unknown;
  }

  export interface FromXMLResult {
    rootElement: ModdleElement;
    warnings: { message: string }[];
  }

  export class BpmnModdle {
    constructor(packages?: Record<string, unknown>);
    fromXML(xml: string, typeName?: string): Promise<FromXMLResult>;
    toXML(element: unknown, options?: { format?: boolean }): Promise<{ xml: string }>;
    create(type: string, attrs?: Record<string, unknown>): ModdleElement;
  }
}

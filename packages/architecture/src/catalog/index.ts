import {
  COMPONENTS,
  type ComponentCategory,
  type ComponentConfigs,
  type ComponentRole,
  type ComponentType,
  type IconKey,
} from "./components";
import { type ConfigSchema, configSchema, type FieldMeta } from "./fields";

export type {
  ComponentCategory,
  ComponentConfigs,
  ComponentRole,
  ComponentType,
  IconKey,
} from "./components";
export type { FieldMeta } from "./fields";

export type ComponentConfig<T extends ComponentType = ComponentType> = ComponentConfigs[T];

export interface ComponentDefinition<T extends ComponentType = ComponentType> {
  type: T;
  category: ComponentCategory;
  role: ComponentRole;
  name: string;
  description: string;
  icon: IconKey;
  /** Validates and normalizes a config object; unknown keys are stripped. */
  configSchema: ConfigSchema;
  defaults: ComponentConfig<T>;
  /** In display order. */
  fields: Array<{ key: string; meta: FieldMeta }>;
}

function define<T extends ComponentType>(type: T): ComponentDefinition<T> {
  const def = COMPONENTS[type];
  const schema = configSchema(def.fields);
  return {
    type,
    category: def.category,
    role: def.role,
    name: def.name,
    description: def.description,
    icon: def.icon,
    configSchema: schema,
    defaults: schema.parse({}) as ComponentConfig<T>,
    fields: Object.entries(def.fields).map(([key, field]) => ({ key, meta: field.meta })),
  };
}

export const COMPONENT_TYPES = Object.keys(COMPONENTS) as ComponentType[];

export const CATALOG = Object.fromEntries(COMPONENT_TYPES.map((type) => [type, define(type)])) as {
  [T in ComponentType]: ComponentDefinition<T>;
};

export const CATEGORIES: ReadonlyArray<{ id: ComponentCategory; name: string }> = [
  { id: "client", name: "Clients" },
  { id: "application", name: "Application" },
  { id: "caching", name: "Caching" },
  { id: "storage", name: "Storage" },
  { id: "messaging", name: "Messaging" },
];

export function isComponentType(value: string): value is ComponentType {
  return Object.hasOwn(COMPONENTS, value);
}

export function roleOf(type: ComponentType): ComponentRole {
  return COMPONENTS[type].role;
}

/** Roles whose nodes define flows: services and background workers. */
export function hasFlows(role: ComponentRole): boolean {
  return role === "service" || role === "consumer";
}

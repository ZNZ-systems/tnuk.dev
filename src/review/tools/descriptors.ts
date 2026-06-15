import type { Tool } from "openai/resources/responses/responses";

import { gitDiffDescriptor } from "./git-diff.js";
import { gitLogDescriptor } from "./git-log.js";
import { listFilesDescriptor } from "./list-files.js";
import { readFileDescriptor } from "./read-file.js";
import type {
  RequiredReviewEvidence,
  ReviewToolFailure,
  RuntimeToolDescriptor,
  ToolDescriptor,
} from "./tool-types.js";

const TOOL_DESCRIPTOR_LIST = [
  gitDiffDescriptor,
  gitLogDescriptor,
  listFilesDescriptor,
  readFileDescriptor,
] as const;

type ToolDescriptorList = typeof TOOL_DESCRIPTOR_LIST;
type DescriptorArgs<Descriptor> = Descriptor extends ToolDescriptor<infer _Name, infer Args, infer _Result>
  ? Args
  : never;
type DescriptorResult<Descriptor> = Descriptor extends ToolDescriptor<infer _Name, infer _Args, infer Result>
  ? Result
  : never;

export type ReviewToolName = ToolDescriptorList[number]["schema"]["name"];
type ToolDescriptorFor<Name extends ReviewToolName> = Extract<
  ToolDescriptorList[number],
  { schema: { name: Name } }
>;
type ToolDescriptorMap = { readonly [Name in ReviewToolName]: ToolDescriptorFor<Name> };

export type ReviewToolArgs = DescriptorArgs<ToolDescriptorList[number]>;
export type ReviewToolResult = DescriptorResult<ToolDescriptorList[number]> | ReviewToolFailure;

export const TOOL_DESCRIPTORS = Object.freeze(
  Object.fromEntries(TOOL_DESCRIPTOR_LIST.map((descriptor) => [descriptor.schema.name, descriptor])),
) as ToolDescriptorMap;
export const REVIEW_TOOL_NAMES = Object.freeze(
  TOOL_DESCRIPTOR_LIST.map((descriptor) => descriptor.schema.name),
);
export const TOOL_DEFINITIONS: readonly Tool[] = Object.freeze(
  TOOL_DESCRIPTOR_LIST.map((descriptor) => descriptor.schema),
);

export function getToolDescriptor(name: string): RuntimeToolDescriptor | undefined {
  if (!Object.hasOwn(TOOL_DESCRIPTORS, name)) {
    return undefined;
  }
  return TOOL_DESCRIPTORS[name as ReviewToolName].runtime;
}

export function isReviewToolName(name: string): name is ReviewToolName {
  return getToolDescriptor(name) !== undefined;
}

export function requiredEvidenceDescriptors(): RequiredReviewEvidence[] {
  return REVIEW_TOOL_NAMES.flatMap((name) => TOOL_DESCRIPTORS[name].requiredEvidence ?? []);
}

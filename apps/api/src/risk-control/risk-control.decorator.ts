import { SetMetadata } from '@nestjs/common';

export type RiskControlEndpoint =
  | 'createTopic'
  | 'createArgument'
  | 'editArgument'
  | 'setVotes'
  | 'topicCommands';

export type RiskControlTopicResolver =
  | { kind: 'param'; paramName: string }
  | { kind: 'argumentIdParam'; paramName: string }
  | { kind: 'constant'; topicId: string };

export interface RiskControlOptions {
  endpoint: RiskControlEndpoint;
  topicResolver: RiskControlTopicResolver;
}

export const RISK_CONTROL_OPTIONS = 'riskControlOptions';

export function RiskControl(options: RiskControlOptions) {
  return SetMetadata(RISK_CONTROL_OPTIONS, options);
}

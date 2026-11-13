import { Hammer, GitBranch, Activity, Workflow, Globe, CalendarClock, Bell, KeyRound, SlidersHorizontal, Users, ShieldCheck } from 'lucide-react';

// Dịch vụ Developer (id khớp server/src/routes/infra.routes.ts)
export const INFRA_NAV = [
  { to: '/svc/apigateway', label: 'Amazon API Gateway', icon: Globe },
  { to: '/svc/stepfunctions', label: 'AWS Step Functions', icon: Workflow },
  { to: '/svc/eventbridge', label: 'Amazon EventBridge', icon: CalendarClock },
  { to: '/svc/sns', label: 'Amazon SNS', icon: Bell },
  { to: '/svc/cloudwatch', label: 'Amazon CloudWatch', icon: Activity },
  { to: '/svc/secretsmanager', label: 'AWS Secrets Manager', icon: KeyRound },
  { to: '/svc/ssm', label: 'Systems Manager', icon: SlidersHorizontal },
  { to: '/svc/cognito', label: 'Amazon Cognito', icon: Users },
  { to: '/svc/kms', label: 'AWS KMS', icon: ShieldCheck },
  { to: '/svc/codebuild', label: 'AWS CodeBuild', icon: Hammer },
  { to: '/svc/codepipeline', label: 'AWS CodePipeline', icon: GitBranch },
];

import {
  Hammer, GitBranch, Activity, Workflow, Globe, CalendarClock, Bell, KeyRound, SlidersHorizontal, Users, ShieldCheck,
  UserCog, Fingerprint, Server, Container, Boxes, Waves, Database, Gauge, Cloud,
} from 'lucide-react';

// Dịch vụ tổng quát (id khớp server/src/routes/infra*.ts). `group` quyết định tiêu đề nhóm trong sidebar.
export const INFRA_NAV = [
  { group: 'Developer Tools', to: '/svc/apigateway', label: 'Amazon API Gateway', icon: Globe },
  { group: 'Developer Tools', to: '/svc/stepfunctions', label: 'AWS Step Functions', icon: Workflow },
  { group: 'Developer Tools', to: '/svc/eventbridge', label: 'Amazon EventBridge', icon: CalendarClock },
  { group: 'Developer Tools', to: '/svc/sns', label: 'Amazon SNS', icon: Bell },
  { group: 'Developer Tools', to: '/svc/cloudwatch', label: 'Amazon CloudWatch', icon: Activity },
  { group: 'Developer Tools', to: '/svc/secretsmanager', label: 'AWS Secrets Manager', icon: KeyRound },
  { group: 'Developer Tools', to: '/svc/ssm', label: 'Systems Manager', icon: SlidersHorizontal },
  { group: 'Developer Tools', to: '/svc/cognito', label: 'Amazon Cognito', icon: Users },
  { group: 'Developer Tools', to: '/svc/kms', label: 'AWS KMS', icon: ShieldCheck },
  { group: 'Developer Tools', to: '/svc/codebuild', label: 'AWS CodeBuild', icon: Hammer },
  { group: 'Developer Tools', to: '/svc/codepipeline', label: 'AWS CodePipeline', icon: GitBranch },

  { group: 'Security & Identity', to: '/svc/iam', label: 'AWS IAM', icon: UserCog },
  { group: 'Security & Identity', to: '/svc/sts', label: 'AWS STS', icon: Fingerprint },

  { group: 'Compute & Containers', to: '/svc/ec2', label: 'Amazon EC2 / VPC', icon: Server },
  { group: 'Compute & Containers', to: '/svc/ecr', label: 'Amazon ECR', icon: Container },
  { group: 'Compute & Containers', to: '/svc/ecs', label: 'Amazon ECS', icon: Boxes },

  { group: 'Data & Streaming', to: '/svc/kinesis', label: 'Amazon Kinesis', icon: Waves },
  { group: 'Data & Streaming', to: '/svc/rds', label: 'Amazon RDS', icon: Database },
  { group: 'Data & Streaming', to: '/svc/elasticache', label: 'Amazon ElastiCache', icon: Gauge },

  { group: 'Networking & Delivery', to: '/svc/cloudfront', label: 'Amazon CloudFront', icon: Cloud },
];

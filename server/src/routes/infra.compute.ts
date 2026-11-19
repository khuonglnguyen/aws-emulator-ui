import {
  ListUsersCommand, CreateUserCommand, DeleteUserCommand, ListAccessKeysCommand, DeleteAccessKeyCommand, CreateAccessKeyCommand,
  ListAttachedUserPoliciesCommand, AttachUserPolicyCommand, DetachUserPolicyCommand, ListUserPoliciesCommand, DeleteUserPolicyCommand,
  ListGroupsForUserCommand, RemoveUserFromGroupCommand, AddUserToGroupCommand,
  ListRolesCommand, CreateRoleCommand, DeleteRoleCommand, ListAttachedRolePoliciesCommand, AttachRolePolicyCommand, DetachRolePolicyCommand,
  ListRolePoliciesCommand, DeleteRolePolicyCommand,
  ListPoliciesCommand, CreatePolicyCommand, DeletePolicyCommand, GetPolicyCommand, GetPolicyVersionCommand, ListPolicyVersionsCommand,
  DeletePolicyVersionCommand, ListEntitiesForPolicyCommand,
  ListGroupsCommand, CreateGroupCommand, DeleteGroupCommand, GetGroupCommand, AttachGroupPolicyCommand,
  ListAttachedGroupPoliciesCommand, DetachGroupPolicyCommand,
} from '@aws-sdk/client-iam';
import { GetCallerIdentityCommand, AssumeRoleCommand, GetSessionTokenCommand, GetAccessKeyInfoCommand } from '@aws-sdk/client-sts';
import {
  DescribeInstancesCommand, RunInstancesCommand, TerminateInstancesCommand, StartInstancesCommand, StopInstancesCommand, RebootInstancesCommand,
  DescribeVpcsCommand, CreateVpcCommand, DeleteVpcCommand, DescribeSubnetsCommand, CreateSubnetCommand, DeleteSubnetCommand,
  DescribeSecurityGroupsCommand, CreateSecurityGroupCommand, DeleteSecurityGroupCommand, AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand, DescribeKeyPairsCommand, CreateKeyPairCommand, DeleteKeyPairCommand, CreateTagsCommand,
} from '@aws-sdk/client-ec2';
import {
  DescribeRepositoriesCommand, CreateRepositoryCommand, DeleteRepositoryCommand, ListImagesCommand, DescribeImagesCommand,
  BatchDeleteImageCommand, PutLifecyclePolicyCommand, GetLifecyclePolicyCommand, PutImageCommand,
  InitiateLayerUploadCommand, UploadLayerPartCommand, CompleteLayerUploadCommand,
} from '@aws-sdk/client-ecr';
import {
  ListClustersCommand, DescribeClustersCommand, CreateClusterCommand, DeleteClusterCommand,
  ListTaskDefinitionsCommand, DescribeTaskDefinitionCommand, RegisterTaskDefinitionCommand, DeregisterTaskDefinitionCommand,
  ListServicesCommand, DescribeServicesCommand, CreateServiceCommand, DeleteServiceCommand, UpdateServiceCommand,
  ListTasksCommand, DescribeTasksCommand, RunTaskCommand, StopTaskCommand,
} from '@aws-sdk/client-ecs';
import { createHash } from 'crypto';
import { iam, sts, ec2, ecr, ecs } from '../aws';
import { Service, Row, bad, date, chunk, tail, num, csv, json } from './infra.types';

const tagName = (tags?: { Key?: string; Value?: string }[]) => tags?.find((t) => t.Key === 'Name')?.Value;
const quiet = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch {
    /* best-effort cleanup */
  }
};

/**
 * Emulator trả timestamp ECS với độ chính xác mà AWS SDK JS không parse được
 * ("Epoch timestamps must be expressed as floating point numbers...") dù thao tác đã được thực hiện.
 * Bọc lại để thao tác ghi không bị báo lỗi giả.
 */
const ecsQuirk = async <T,>(p: Promise<T>): Promise<T | { note: string }> => {
  try {
    return await p;
  } catch (e: any) {
    if (/Epoch timestamps|Deserialization error/i.test(String(e?.message)))
      return { note: 'Thao tác đã được thực hiện. Emulator trả timestamp mà SDK không đọc được nên không có chi tiết phản hồi, hãy bấm Refresh.' };
    throw e;
  }
};

/** Upload một blob nhỏ lên ECR (initiate → part → complete) và trả digest */
async function pushBlob(res: any, repositoryName: string, data: Buffer) {
  const digest = 'sha256:' + createHash('sha256').update(data).digest('hex');
  const { uploadId } = await ecr(res).send(new InitiateLayerUploadCommand({ repositoryName }));
  await ecr(res).send(new UploadLayerPartCommand({ repositoryName, uploadId, partFirstByte: 0, partLastByte: data.length - 1, layerPartBlob: data }));
  await ecr(res).send(new CompleteLayerUploadCommand({ repositoryName, uploadId, layerDigests: [digest] }));
  return { digest, size: data.length };
}

const TRUST_SAMPLE = JSON.stringify(
  { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
  null,
  2,
);
const POLICY_SAMPLE = JSON.stringify(
  { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: ['arn:aws:s3:::my-bucket', 'arn:aws:s3:::my-bucket/*'] }] },
  null,
  2,
);

/** Field + 2 action dùng chung cho user/role/group: attach, detach, list policy */
const policyArnField = {
  key: 'policyArn',
  label: 'Policy ARN',
  required: true,
  placeholder: 'arn:aws:iam::000000000000:policy/my-policy',
  hint: 'Tạo policy ở tab Policies trước, rồi dán ARN vào đây (xem cột ARN).',
};

export const COMPUTE_SERVICES: Service[] = [
  /* ───────────────────────────── IAM ───────────────────────────── */
  {
    id: 'iam',
    label: 'AWS IAM',
    description:
      'Quản lý ai (user/role) được làm gì (policy) trên tài nguyên nào. Mọi lời gọi AWS đều được IAM kiểm tra quyền.',
    concepts: [
      'User: danh tính dài hạn của người/ứng dụng, có access key.',
      'Role: danh tính tạm thời được "assume" (Lambda, EC2, ECS task dùng role, không dùng key).',
      'Policy: tài liệu JSON gồm Effect / Action / Resource. Mặc định là deny.',
      'Trust policy: quy định AI được phép assume role.',
    ],
    resources: [
      {
        id: 'users',
        label: 'Users',
        description: 'Danh tính dài hạn. Gắn policy để cấp quyền, tạo access key cho CLI/SDK.',
        listCli: 'aws iam list-users',
        columns: [
          { key: 'name', label: 'User' },
          { key: 'arn', label: 'ARN' },
          { key: 'created', label: 'Created' },
        ],
        list: async (res) =>
          ((await iam(res).send(new ListUsersCommand({}))).Users || []).map((u) => ({
            id: u.UserName!, name: u.UserName, arn: u.Arn, created: date(u.CreateDate), raw: u,
          })),
        create: {
          fields: [{ key: 'name', label: 'User name', required: true, placeholder: 'dev-alice' }],
          cli: 'aws iam create-user --user-name {name}',
          run: (res, b) => iam(res).send(new CreateUserCommand({ UserName: b.name })),
        },
        removeCli: 'aws iam delete-user --user-name {id}',
        remove: async (res, id) => {
          const c = iam(res);
          for (const k of (await c.send(new ListAccessKeysCommand({ UserName: id }))).AccessKeyMetadata || [])
            await quiet(c.send(new DeleteAccessKeyCommand({ UserName: id, AccessKeyId: k.AccessKeyId })));
          for (const p of (await c.send(new ListAttachedUserPoliciesCommand({ UserName: id }))).AttachedPolicies || [])
            await quiet(c.send(new DetachUserPolicyCommand({ UserName: id, PolicyArn: p.PolicyArn })));
          for (const n of (await c.send(new ListUserPoliciesCommand({ UserName: id }))).PolicyNames || [])
            await quiet(c.send(new DeleteUserPolicyCommand({ UserName: id, PolicyName: n })));
          for (const g of (await c.send(new ListGroupsForUserCommand({ UserName: id }))).Groups || [])
            await quiet(c.send(new RemoveUserFromGroupCommand({ UserName: id, GroupName: g.GroupName })));
          return c.send(new DeleteUserCommand({ UserName: id }));
        },
        actions: [
          {
            id: 'attach-policy', label: 'Attach policy', description: 'Gắn managed policy vào user để cấp quyền.',
            fields: [policyArnField],
            cli: 'aws iam attach-user-policy --user-name {id} --policy-arn {policyArn}',
            run: (res, id, b) => iam(res).send(new AttachUserPolicyCommand({ UserName: id, PolicyArn: b.policyArn })),
          },
          {
            id: 'detach-policy', label: 'Detach policy', danger: true,
            fields: [policyArnField],
            cli: 'aws iam detach-user-policy --user-name {id} --policy-arn {policyArn}',
            run: (res, id, b) => iam(res).send(new DetachUserPolicyCommand({ UserName: id, PolicyArn: b.policyArn })),
          },
          {
            id: 'list-policies', label: 'Policies đã gắn', description: 'Xem user đang có những policy nào (managed + inline).',
            cli: 'aws iam list-attached-user-policies --user-name {id}',
            run: async (res, id) => ({
              attached: (await iam(res).send(new ListAttachedUserPoliciesCommand({ UserName: id }))).AttachedPolicies,
              inline: (await iam(res).send(new ListUserPoliciesCommand({ UserName: id }))).PolicyNames,
            }),
          },
          {
            id: 'create-access-key', label: 'Create access key',
            description: 'Sinh cặp AccessKeyId + SecretAccessKey. Secret chỉ hiện MỘT LẦN, hãy lưu lại.',
            cli: 'aws iam create-access-key --user-name {id}',
            run: async (res, id) => (await iam(res).send(new CreateAccessKeyCommand({ UserName: id }))).AccessKey,
          },
          {
            id: 'list-access-keys', label: 'List access keys',
            cli: 'aws iam list-access-keys --user-name {id}',
            run: async (res, id) => (await iam(res).send(new ListAccessKeysCommand({ UserName: id }))).AccessKeyMetadata,
          },
          {
            id: 'delete-access-key', label: 'Delete access key', danger: true,
            fields: [{ key: 'accessKeyId', label: 'Access key ID', required: true, placeholder: 'AKIA...' }],
            cli: 'aws iam delete-access-key --user-name {id} --access-key-id {accessKeyId}',
            run: (res, id, b) => iam(res).send(new DeleteAccessKeyCommand({ UserName: id, AccessKeyId: b.accessKeyId })),
          },
        ],
      },
      {
        id: 'roles',
        label: 'Roles',
        description: 'Danh tính tạm thời. Dịch vụ (Lambda, ECS, EC2…) assume role để lấy credential ngắn hạn, an toàn hơn access key.',
        listCli: 'aws iam list-roles',
        columns: [
          { key: 'name', label: 'Role' },
          { key: 'arn', label: 'ARN' },
          { key: 'created', label: 'Created' },
        ],
        list: async (res) =>
          ((await iam(res).send(new ListRolesCommand({}))).Roles || []).map((r) => ({
            id: r.RoleName!, name: r.RoleName, arn: r.Arn, created: date(r.CreateDate), raw: r,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Role name', required: true, placeholder: 'lambda-exec-role' },
            { key: 'description', label: 'Description' },
            { key: 'trust', label: 'Trust policy (JSON)', multiline: true, required: true, default: TRUST_SAMPLE, hint: 'Principal = ai được phép assume role này.' },
          ],
          cli: 'aws iam create-role --role-name {name} --assume-role-policy-document file://trust.json',
          run: (res, b) =>
            iam(res).send(new CreateRoleCommand({ RoleName: b.name, Description: b.description || undefined, AssumeRolePolicyDocument: JSON.stringify(json(b.trust, 'Trust policy')) })),
        },
        removeCli: 'aws iam delete-role --role-name {id}',
        remove: async (res, id) => {
          const c = iam(res);
          for (const p of (await c.send(new ListAttachedRolePoliciesCommand({ RoleName: id }))).AttachedPolicies || [])
            await quiet(c.send(new DetachRolePolicyCommand({ RoleName: id, PolicyArn: p.PolicyArn })));
          for (const n of (await c.send(new ListRolePoliciesCommand({ RoleName: id }))).PolicyNames || [])
            await quiet(c.send(new DeleteRolePolicyCommand({ RoleName: id, PolicyName: n })));
          return c.send(new DeleteRoleCommand({ RoleName: id }));
        },
        actions: [
          {
            id: 'attach-policy', label: 'Attach policy', fields: [policyArnField],
            cli: 'aws iam attach-role-policy --role-name {id} --policy-arn {policyArn}',
            run: (res, id, b) => iam(res).send(new AttachRolePolicyCommand({ RoleName: id, PolicyArn: b.policyArn })),
          },
          {
            id: 'detach-policy', label: 'Detach policy', danger: true, fields: [policyArnField],
            cli: 'aws iam detach-role-policy --role-name {id} --policy-arn {policyArn}',
            run: (res, id, b) => iam(res).send(new DetachRolePolicyCommand({ RoleName: id, PolicyArn: b.policyArn })),
          },
          {
            id: 'list-policies', label: 'Policies đã gắn',
            cli: 'aws iam list-attached-role-policies --role-name {id}',
            run: async (res, id) => ({
              attached: (await iam(res).send(new ListAttachedRolePoliciesCommand({ RoleName: id }))).AttachedPolicies,
              inline: (await iam(res).send(new ListRolePoliciesCommand({ RoleName: id }))).PolicyNames,
            }),
          },
          {
            id: 'assume-role', label: 'Assume role (STS)',
            description: 'Đóng vai role để nhận credential tạm. Chỉ thành công nếu trust policy của role cho phép bạn: với trust mẫu (Principal = lambda.amazonaws.com) sẽ bị AccessDenied; hãy tạo role có Principal {"AWS":"arn:aws:iam::000000000000:root"}.',
            fields: [
              { key: 'roleArn', label: 'Role ARN', required: true, placeholder: 'arn:aws:iam::000000000000:role/my-role', hint: 'Xem cột ARN của role.' },
              { key: 'session', label: 'Session name', required: true, default: 'learn-session' },
            ],
            cli: 'aws sts assume-role --role-arn {roleArn} --role-session-name {session}',
            run: async (res, _id, b) => (await sts(res).send(new AssumeRoleCommand({ RoleArn: b.roleArn, RoleSessionName: b.session }))).Credentials,
          },
        ],
      },
      {
        id: 'policies',
        label: 'Policies',
        description: 'Tài liệu JSON mô tả quyền (customer managed). Mặc định mọi thứ bị deny; chỉ Allow những gì cần (least privilege).',
        listCli: 'aws iam list-policies --scope Local',
        columns: [
          { key: 'name', label: 'Policy' },
          { key: 'arn', label: 'ARN' },
          { key: 'attachments', label: 'Attachments' },
          { key: 'created', label: 'Created' },
        ],
        list: async (res) =>
          ((await iam(res).send(new ListPoliciesCommand({ Scope: 'Local' }))).Policies || []).map((p) => ({
            id: p.Arn!, name: p.PolicyName, arn: p.Arn, attachments: p.AttachmentCount, created: date(p.CreateDate), raw: p,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Policy name', required: true, placeholder: 's3-read-only' },
            { key: 'document', label: 'Policy document (JSON)', multiline: true, required: true, default: POLICY_SAMPLE, hint: 'Effect: Allow/Deny · Action: dịch vụ:thao-tác · Resource: ARN.' },
          ],
          cli: 'aws iam create-policy --policy-name {name} --policy-document file://policy.json',
          run: (res, b) => iam(res).send(new CreatePolicyCommand({ PolicyName: b.name, PolicyDocument: JSON.stringify(json(b.document, 'Policy document')) })),
        },
        removeCli: 'aws iam delete-policy --policy-arn {id}',
        remove: async (res, id) => {
          const c = iam(res);
          const ents = await c.send(new ListEntitiesForPolicyCommand({ PolicyArn: id }));
          for (const u of ents.PolicyUsers || []) await quiet(c.send(new DetachUserPolicyCommand({ UserName: u.UserName, PolicyArn: id })));
          for (const r of ents.PolicyRoles || []) await quiet(c.send(new DetachRolePolicyCommand({ RoleName: r.RoleName, PolicyArn: id })));
          for (const g of ents.PolicyGroups || []) await quiet(c.send(new DetachGroupPolicyCommand({ GroupName: g.GroupName, PolicyArn: id })));
          for (const v of (await c.send(new ListPolicyVersionsCommand({ PolicyArn: id }))).Versions || [])
            if (!v.IsDefaultVersion) await quiet(c.send(new DeletePolicyVersionCommand({ PolicyArn: id, VersionId: v.VersionId })));
          return c.send(new DeletePolicyCommand({ PolicyArn: id }));
        },
        actions: [
          {
            id: 'view-document', label: 'Xem nội dung policy', description: 'Lấy JSON của phiên bản mặc định.',
            cli: 'aws iam get-policy-version --policy-arn {id} --version-id v1',
            run: async (res, id) => {
              const p = (await iam(res).send(new GetPolicyCommand({ PolicyArn: id }))).Policy;
              const v = (await iam(res).send(new GetPolicyVersionCommand({ PolicyArn: id, VersionId: p?.DefaultVersionId }))).PolicyVersion;
              return { policy: p, document: v?.Document ? JSON.parse(decodeURIComponent(v.Document)) : null };
            },
          },
        ],
      },
      {
        id: 'groups',
        label: 'Groups',
        description: 'Nhóm user. Gắn policy cho group thay vì từng user để dễ quản lý.',
        listCli: 'aws iam list-groups',
        columns: [
          { key: 'name', label: 'Group' },
          { key: 'arn', label: 'ARN' },
          { key: 'created', label: 'Created' },
        ],
        list: async (res) =>
          ((await iam(res).send(new ListGroupsCommand({}))).Groups || []).map((g) => ({
            id: g.GroupName!, name: g.GroupName, arn: g.Arn, created: date(g.CreateDate), raw: g,
          })),
        create: {
          fields: [{ key: 'name', label: 'Group name', required: true, placeholder: 'developers' }],
          cli: 'aws iam create-group --group-name {name}',
          run: (res, b) => iam(res).send(new CreateGroupCommand({ GroupName: b.name })),
        },
        removeCli: 'aws iam delete-group --group-name {id}',
        remove: async (res, id) => {
          const c = iam(res);
          for (const u of (await c.send(new GetGroupCommand({ GroupName: id }))).Users || [])
            await quiet(c.send(new RemoveUserFromGroupCommand({ GroupName: id, UserName: u.UserName })));
          for (const p of (await c.send(new ListAttachedGroupPoliciesCommand({ GroupName: id }))).AttachedPolicies || [])
            await quiet(c.send(new DetachGroupPolicyCommand({ GroupName: id, PolicyArn: p.PolicyArn })));
          return c.send(new DeleteGroupCommand({ GroupName: id }));
        },
        actions: [
          {
            id: 'add-user', label: 'Add user',
            fields: [{ key: 'user', label: 'User name', required: true, placeholder: 'dev-alice' }],
            cli: 'aws iam add-user-to-group --group-name {id} --user-name {user}',
            run: (res, id, b) => iam(res).send(new AddUserToGroupCommand({ GroupName: id, UserName: b.user })),
          },
          {
            id: 'remove-user', label: 'Remove user', danger: true,
            fields: [{ key: 'user', label: 'User name', required: true }],
            cli: 'aws iam remove-user-from-group --group-name {id} --user-name {user}',
            run: (res, id, b) => iam(res).send(new RemoveUserFromGroupCommand({ GroupName: id, UserName: b.user })),
          },
          {
            id: 'attach-policy', label: 'Attach policy', fields: [policyArnField],
            cli: 'aws iam attach-group-policy --group-name {id} --policy-arn {policyArn}',
            run: (res, id, b) => iam(res).send(new AttachGroupPolicyCommand({ GroupName: id, PolicyArn: b.policyArn })),
          },
          {
            id: 'members', label: 'Xem thành viên', cli: 'aws iam get-group --group-name {id}',
            run: async (res, id) => (await iam(res).send(new GetGroupCommand({ GroupName: id }))).Users,
          },
        ],
      },
    ],
  },

  /* ───────────────────────────── STS ───────────────────────────── */
  {
    id: 'sts',
    label: 'AWS STS',
    description: 'Cấp credential tạm thời và cho biết "tôi đang là ai". Nền tảng của assume-role và federation.',
    concepts: [
      'GetCallerIdentity: kiểm tra credential hiện tại thuộc account/user/role nào (lệnh debug đầu tiên khi gặp AccessDenied).',
      'AssumeRole: đổi sang role khác, nhận key + SessionToken có thời hạn.',
    ],
    resources: [
      {
        id: 'identity',
        label: 'Caller identity',
        description: 'Danh tính mà Console đang dùng để gọi emulator.',
        listCli: 'aws sts get-caller-identity',
        columns: [
          { key: 'account', label: 'Account' },
          { key: 'arn', label: 'ARN' },
          { key: 'userId', label: 'User ID' },
        ],
        list: async (res) => {
          const r = await sts(res).send(new GetCallerIdentityCommand({}));
          return [{ id: r.Arn!, account: r.Account, arn: r.Arn, userId: r.UserId, raw: { Account: r.Account, Arn: r.Arn, UserId: r.UserId } }];
        },
        actions: [
          {
            id: 'assume-role', label: 'Assume role', scope: 'resource',
            description: 'Đổi sang role khác để nhận credential tạm. Role cần có trust policy cho phép bạn.',
            fields: [
              { key: 'roleArn', label: 'Role ARN', required: true, placeholder: 'arn:aws:iam::000000000000:role/my-role' },
              { key: 'session', label: 'Session name', required: true, default: 'learn-session' },
              { key: 'duration', label: 'Duration (giây)', default: '3600' },
            ],
            cli: 'aws sts assume-role --role-arn {roleArn} --role-session-name {session} --duration-seconds {duration}',
            run: async (res, _id, b) =>
              (await sts(res).send(new AssumeRoleCommand({ RoleArn: b.roleArn, RoleSessionName: b.session, DurationSeconds: num(b.duration, 3600) }))),
          },
          {
            id: 'get-session-token', label: 'Get session token', scope: 'resource',
            description: 'Lấy credential tạm cho chính user hiện tại (thường dùng kèm MFA).',
            fields: [{ key: 'duration', label: 'Duration (giây)', default: '3600' }],
            cli: 'aws sts get-session-token --duration-seconds {duration}',
            run: async (res, _id, b) => (await sts(res).send(new GetSessionTokenCommand({ DurationSeconds: num(b.duration, 3600) }))).Credentials,
          },
          {
            id: 'access-key-info', label: 'Access key → account', scope: 'resource',
            description: 'Tra access key ID thuộc account nào.',
            fields: [{ key: 'accessKeyId', label: 'Access key ID', required: true }],
            cli: 'aws sts get-access-key-info --access-key-id {accessKeyId}',
            run: async (res, _id, b) => sts(res).send(new GetAccessKeyInfoCommand({ AccessKeyId: b.accessKeyId })),
          },
        ],
      },
    ],
  },

  /* ───────────────────────────── EC2 + VPC ───────────────────────────── */
  {
    id: 'ec2',
    label: 'Amazon EC2 / VPC',
    description: 'Máy chủ ảo (EC2) chạy trong mạng riêng ảo (VPC). Security group là firewall cấp instance. Instance cần vài giây để chuyển trạng thái (pending → running); bấm Refresh trước khi Stop/Start/Reboot, và đợi instance terminated xong mới xóa được subnet/VPC.',
    concepts: [
      'VPC: mạng riêng, định nghĩa bởi dải CIDR (vd 10.0.0.0/16).',
      'Subnet: một phần của VPC trong 1 Availability Zone.',
      'Security group: firewall stateful, chỉ có luật Allow (inbound/outbound).',
      'Instance: máy ảo từ AMI + instance type; vòng đời: pending → running → stopped → terminated.',
      'Key pair: SSH key để đăng nhập instance Linux.',
    ],
    resources: [
      {
        id: 'instances',
        label: 'Instances',
        description: 'Máy ảo. Stop giữ lại đĩa, Terminate xóa hẳn.',
        listCli: 'aws ec2 describe-instances',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'instanceId', label: 'Instance ID' },
          { key: 'state', label: 'State' },
          { key: 'type', label: 'Type' },
          { key: 'ip', label: 'Private IP' },
        ],
        list: async (res) =>
          ((await ec2(res).send(new DescribeInstancesCommand({}))).Reservations || [])
            .flatMap((r) => r.Instances || [])
            .map((i) => ({
              id: i.InstanceId!, name: tagName(i.Tags), instanceId: i.InstanceId, state: i.State?.Name, type: i.InstanceType, ip: i.PrivateIpAddress, raw: i,
            })),
        create: {
          fields: [
            { key: 'name', label: 'Name tag', placeholder: 'web-1' },
            { key: 'imageId', label: 'AMI ID', required: true, default: 'ami-0abcdef1234567890', hint: 'ID của image (hệ điều hành) để khởi tạo.' },
            { key: 'type', label: 'Instance type', options: ['t3.micro', 't3.small', 't3.medium', 't2.micro'] },
            { key: 'subnetId', label: 'Subnet ID (tuỳ chọn)', hint: 'Lấy ở tab Subnets. Bỏ trống = subnet mặc định.' },
            { key: 'keyName', label: 'Key pair (tuỳ chọn)', hint: 'Tên key pair ở tab Key pairs.' },
          ],
          cli: 'aws ec2 run-instances --image-id {imageId} --instance-type {type} --count 1 --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value={name}}]"',
          run: (res, b) =>
            ec2(res).send(
              new RunInstancesCommand({
                ImageId: b.imageId, InstanceType: b.type as any, MinCount: 1, MaxCount: 1,
                SubnetId: b.subnetId || undefined, KeyName: b.keyName || undefined,
                TagSpecifications: b.name ? [{ ResourceType: 'instance', Tags: [{ Key: 'Name', Value: b.name }] }] : undefined,
              }),
            ),
        },
        removeCli: 'aws ec2 terminate-instances --instance-ids {id}',
        remove: (res, id) => ec2(res).send(new TerminateInstancesCommand({ InstanceIds: [id] })),
        actions: [
          { id: 'start', label: 'Start', cli: 'aws ec2 start-instances --instance-ids {id}', run: (res, id) => ec2(res).send(new StartInstancesCommand({ InstanceIds: [id] })) },
          { id: 'stop', label: 'Stop', cli: 'aws ec2 stop-instances --instance-ids {id}', run: (res, id) => ec2(res).send(new StopInstancesCommand({ InstanceIds: [id] })) },
          { id: 'reboot', label: 'Reboot', cli: 'aws ec2 reboot-instances --instance-ids {id}', run: (res, id) => ec2(res).send(new RebootInstancesCommand({ InstanceIds: [id] })) },
          {
            id: 'tag', label: 'Add tag', description: 'Tag = cặp key/value để phân loại, tìm kiếm và tính chi phí.',
            fields: [
              { key: 'key', label: 'Tag key', required: true, default: 'env' },
              { key: 'value', label: 'Tag value', required: true, default: 'dev' },
            ],
            cli: 'aws ec2 create-tags --resources {id} --tags Key={key},Value={value}',
            run: (res, id, b) => ec2(res).send(new CreateTagsCommand({ Resources: [id], Tags: [{ Key: b.key, Value: b.value }] })),
          },
        ],
      },
      {
        id: 'vpcs',
        label: 'VPCs',
        description: 'Mạng riêng ảo, cô lập với các VPC khác.',
        listCli: 'aws ec2 describe-vpcs',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'vpcId', label: 'VPC ID' },
          { key: 'cidr', label: 'CIDR' },
          { key: 'state', label: 'State' },
          { key: 'default', label: 'Default' },
        ],
        list: async (res) =>
          ((await ec2(res).send(new DescribeVpcsCommand({}))).Vpcs || []).map((v) => ({
            id: v.VpcId!, name: tagName(v.Tags), vpcId: v.VpcId, cidr: v.CidrBlock, state: v.State, default: v.IsDefault ? 'yes' : 'no', raw: v,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Name tag', placeholder: 'my-vpc' },
            { key: 'cidr', label: 'CIDR block', required: true, default: '10.0.0.0/16', hint: '/16 ≈ 65.536 IP. Không trùng với mạng khác bạn sẽ nối.' },
          ],
          cli: 'aws ec2 create-vpc --cidr-block {cidr}',
          run: (res, b) =>
            ec2(res).send(new CreateVpcCommand({ CidrBlock: b.cidr, TagSpecifications: b.name ? [{ ResourceType: 'vpc', Tags: [{ Key: 'Name', Value: b.name }] }] : undefined })),
        },
        removeCli: 'aws ec2 delete-vpc --vpc-id {id}',
        remove: (res, id) => ec2(res).send(new DeleteVpcCommand({ VpcId: id })),
      },
      {
        id: 'subnets',
        label: 'Subnets',
        description: 'Chia VPC thành các mạng con theo AZ. Subnet public có route ra Internet Gateway, private thì không.',
        listCli: 'aws ec2 describe-subnets',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'subnetId', label: 'Subnet ID' },
          { key: 'vpc', label: 'VPC' },
          { key: 'cidr', label: 'CIDR' },
          { key: 'az', label: 'AZ' },
        ],
        list: async (res) =>
          ((await ec2(res).send(new DescribeSubnetsCommand({}))).Subnets || []).map((s) => ({
            id: s.SubnetId!, name: tagName(s.Tags), subnetId: s.SubnetId, vpc: s.VpcId, cidr: s.CidrBlock, az: s.AvailabilityZone, raw: s,
          })),
        create: {
          fields: [
            { key: 'vpcId', label: 'VPC ID', required: true, placeholder: 'vpc-...', hint: 'Lấy ở tab VPCs.' },
            { key: 'cidr', label: 'CIDR block', required: true, default: '10.0.1.0/24', hint: 'Phải nằm trong CIDR của VPC.' },
            { key: 'az', label: 'Availability zone (tuỳ chọn)', placeholder: 'us-east-1a' },
          ],
          cli: 'aws ec2 create-subnet --vpc-id {vpcId} --cidr-block {cidr} --availability-zone {az}',
          run: (res, b) => ec2(res).send(new CreateSubnetCommand({ VpcId: b.vpcId, CidrBlock: b.cidr, AvailabilityZone: b.az || undefined })),
        },
        removeCli: 'aws ec2 delete-subnet --subnet-id {id}',
        remove: (res, id) => ec2(res).send(new DeleteSubnetCommand({ SubnetId: id })),
      },
      {
        id: 'security-groups',
        label: 'Security groups',
        description: 'Firewall stateful gắn vào instance. Chỉ có luật Allow; không khớp luật nào = bị chặn.',
        listCli: 'aws ec2 describe-security-groups',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'groupId', label: 'Group ID' },
          { key: 'vpc', label: 'VPC' },
          { key: 'rules', label: 'Inbound rules' },
        ],
        list: async (res) =>
          ((await ec2(res).send(new DescribeSecurityGroupsCommand({}))).SecurityGroups || []).map((g) => ({
            id: g.GroupId!, name: g.GroupName, groupId: g.GroupId, vpc: g.VpcId, rules: (g.IpPermissions || []).length, raw: g,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Group name', required: true, placeholder: 'web-sg' },
            { key: 'description', label: 'Description', required: true, default: 'Allow web traffic' },
            { key: 'vpcId', label: 'VPC ID (tuỳ chọn)', hint: 'Bỏ trống = VPC mặc định.' },
          ],
          cli: 'aws ec2 create-security-group --group-name {name} --description "{description}" --vpc-id {vpcId}',
          run: (res, b) => ec2(res).send(new CreateSecurityGroupCommand({ GroupName: b.name, Description: b.description, VpcId: b.vpcId || undefined })),
        },
        removeCli: 'aws ec2 delete-security-group --group-id {id}',
        remove: (res, id) => ec2(res).send(new DeleteSecurityGroupCommand({ GroupId: id })),
        actions: [
          {
            id: 'allow-inbound', label: 'Allow inbound', description: 'Thêm luật cho phép traffic vào (vd: HTTP 80 từ mọi nơi, SSH 22 từ IP của bạn).',
            fields: [
              { key: 'protocol', label: 'Protocol', options: ['tcp', 'udp', 'icmp'] },
              { key: 'port', label: 'Port', required: true, default: '80' },
              { key: 'cidr', label: 'Source CIDR', required: true, default: '0.0.0.0/0', hint: '0.0.0.0/0 = mọi nơi. SSH nên giới hạn về IP của bạn.' },
            ],
            cli: 'aws ec2 authorize-security-group-ingress --group-id {id} --protocol {protocol} --port {port} --cidr {cidr}',
            run: (res, id, b) =>
              ec2(res).send(new AuthorizeSecurityGroupIngressCommand({
                GroupId: id,
                IpPermissions: [{ IpProtocol: b.protocol, FromPort: num(b.port, 0), ToPort: num(b.port, 0), IpRanges: [{ CidrIp: b.cidr }] }],
              })),
          },
          {
            id: 'revoke-inbound', label: 'Revoke inbound', danger: true,
            fields: [
              { key: 'protocol', label: 'Protocol', options: ['tcp', 'udp', 'icmp'] },
              { key: 'port', label: 'Port', required: true, default: '80' },
              { key: 'cidr', label: 'Source CIDR', required: true, default: '0.0.0.0/0' },
            ],
            cli: 'aws ec2 revoke-security-group-ingress --group-id {id} --protocol {protocol} --port {port} --cidr {cidr}',
            run: (res, id, b) =>
              ec2(res).send(new RevokeSecurityGroupIngressCommand({
                GroupId: id,
                IpPermissions: [{ IpProtocol: b.protocol, FromPort: num(b.port, 0), ToPort: num(b.port, 0), IpRanges: [{ CidrIp: b.cidr }] }],
              })),
          },
        ],
      },
      {
        id: 'key-pairs',
        label: 'Key pairs',
        description: 'Cặp khóa SSH. AWS giữ public key; private key (.pem) chỉ hiện MỘT LẦN khi tạo.',
        listCli: 'aws ec2 describe-key-pairs',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'keyPairId', label: 'Key pair ID' },
          { key: 'type', label: 'Type' },
          { key: 'fingerprint', label: 'Fingerprint' },
        ],
        list: async (res) =>
          ((await ec2(res).send(new DescribeKeyPairsCommand({}))).KeyPairs || []).map((k) => ({
            id: k.KeyPairId || k.KeyName!, name: k.KeyName, keyPairId: k.KeyPairId, type: k.KeyType, fingerprint: k.KeyFingerprint, raw: k,
          })),
        create: {
          showResult: true,
          fields: [{ key: 'name', label: 'Key name', required: true, placeholder: 'my-key' }],
          cli: 'aws ec2 create-key-pair --key-name {name} --query KeyMaterial --output text > {name}.pem',
          run: (res, b) => ec2(res).send(new CreateKeyPairCommand({ KeyName: b.name })),
        },
        removeCli: 'aws ec2 delete-key-pair --key-pair-id {id}',
        remove: (res, id) => ec2(res).send(new DeleteKeyPairCommand(id.startsWith('key-') ? { KeyPairId: id } : { KeyName: id })),
      },
    ],
  },

  /* ───────────────────────────── ECR ───────────────────────────── */
  {
    id: 'ecr',
    label: 'Amazon ECR',
    description: 'Kho Docker image riêng. CI build image rồi push lên ECR; ECS/EKS/Lambda kéo image từ đây.',
    concepts: [
      'Repository: nơi chứa nhiều phiên bản (tag) của một image.',
      'Tag mutability: IMMUTABLE chặn ghi đè tag (vd: v1.0.0) để deploy tái lập được.',
      'Lifecycle policy: tự xóa image cũ (vd: chỉ giữ 10 image mới nhất).',
      'Push: docker login bằng token ECR → docker tag → docker push.',
    ],
    resources: [
      {
        id: 'repositories',
        label: 'Repositories',
        listCli: 'aws ecr describe-repositories',
        columns: [
          { key: 'name', label: 'Repository' },
          { key: 'uri', label: 'URI' },
          { key: 'mutability', label: 'Tag mutability' },
          { key: 'scan', label: 'Scan on push' },
        ],
        list: async (res) =>
          ((await ecr(res).send(new DescribeRepositoriesCommand({}))).repositories || []).map((r) => ({
            id: r.repositoryName!, name: r.repositoryName, uri: r.repositoryUri, mutability: r.imageTagMutability, scan: String(r.imageScanningConfiguration?.scanOnPush ?? false), raw: r,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Repository name', required: true, placeholder: 'my-team/api' },
            { key: 'mutability', label: 'Tag mutability', options: ['MUTABLE', 'IMMUTABLE'] },
            { key: 'scan', label: 'Scan on push', options: ['false', 'true'] },
          ],
          cli: 'aws ecr create-repository --repository-name {name} --image-tag-mutability {mutability} --image-scanning-configuration scanOnPush={scan}',
          run: (res, b) =>
            ecr(res).send(new CreateRepositoryCommand({
              repositoryName: b.name, imageTagMutability: b.mutability as any, imageScanningConfiguration: { scanOnPush: b.scan === 'true' },
            })),
        },
        removeCli: 'aws ecr delete-repository --repository-name {id} --force',
        remove: (res, id) => ecr(res).send(new DeleteRepositoryCommand({ repositoryName: id, force: true })),
        actions: [
          {
            id: 'put-lifecycle', label: 'Set lifecycle policy', description: 'Tự động dọn image cũ để tiết kiệm dung lượng.',
            fields: [{
              key: 'policy', label: 'Lifecycle policy (JSON)', multiline: true, required: true,
              default: JSON.stringify({ rules: [{ rulePriority: 1, description: 'Keep last 10 images', selection: { tagStatus: 'any', countType: 'imageCountMoreThan', countNumber: 10 }, action: { type: 'expire' } }] }, null, 2),
            }],
            cli: 'aws ecr put-lifecycle-policy --repository-name {id} --lifecycle-policy-text file://policy.json',
            run: (res, id, b) => ecr(res).send(new PutLifecyclePolicyCommand({ repositoryName: id, lifecyclePolicyText: JSON.stringify(json(b.policy, 'Lifecycle policy')) })),
          },
          {
            id: 'get-lifecycle', label: 'Xem lifecycle policy', cli: 'aws ecr get-lifecycle-policy --repository-name {id}',
            run: (res, id) => ecr(res).send(new GetLifecyclePolicyCommand({ repositoryName: id })),
          },
          {
            id: 'push-sample', label: 'Push sample image',
            description: 'Tự upload 1 config blob + 1 layer nhỏ rồi put manifest, để thử luồng tag / list / xóa image mà không cần Docker.',
            fields: [{ key: 'tag', label: 'Image tag', required: true, default: 'v1' }],
            cli: 'docker tag app:latest <registry>/{id}:{tag}  &&  docker push <registry>/{id}:{tag}',
            run: async (res, id, b) => {
              const layer = await pushBlob(res, id, Buffer.from(`sample layer ${Date.now()}`));
              const config = await pushBlob(res, id, Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', rootfs: { type: 'layers', diff_ids: [layer.digest] } })));
              const manifest = {
                schemaVersion: 2,
                mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                config: { mediaType: 'application/vnd.docker.container.image.v1+json', size: config.size, digest: config.digest },
                layers: [{ mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: layer.size, digest: layer.digest }],
              };
              return ecr(res).send(new PutImageCommand({ repositoryName: id, imageTag: b.tag, imageManifest: JSON.stringify(manifest) }));
            },
          },
        ],
      },
      {
        id: 'images',
        label: 'Images',
        description: 'Các image (digest + tag) trong tất cả repository.',
        listCli: 'aws ecr describe-images --repository-name <repo>',
        columns: [
          { key: 'repo', label: 'Repository' },
          { key: 'tags', label: 'Tags' },
          { key: 'digest', label: 'Digest' },
          { key: 'pushed', label: 'Pushed' },
        ],
        list: async (res) => {
          const rows: Row[] = [];
          for (const r of (await ecr(res).send(new DescribeRepositoriesCommand({}))).repositories || []) {
            try {
              for (const i of (await ecr(res).send(new DescribeImagesCommand({ repositoryName: r.repositoryName }))).imageDetails || [])
                rows.push({ id: `${r.repositoryName}@${i.imageDigest}`, repo: r.repositoryName, tags: (i.imageTags || []).join(', ') || '<untagged>', digest: i.imageDigest, pushed: date(i.imagePushedAt), raw: i });
            } catch { /* repo rỗng/không hỗ trợ */ }
          }
          return rows;
        },
        removeCli: 'aws ecr batch-delete-image --repository-name <repo> --image-ids imageDigest=<digest>',
        remove: (res, id) => {
          const [repo, digest] = id.split('@');
          return ecr(res).send(new BatchDeleteImageCommand({ repositoryName: repo, imageIds: [{ imageDigest: digest }] }));
        },
      },
    ],
  },

  /* ───────────────────────────── ECS ───────────────────────────── */
  {
    id: 'ecs',
    label: 'Amazon ECS',
    description: 'Chạy container được quản lý. Bạn mô tả container (task definition), ECS giữ đủ số bản chạy (service).',
    concepts: [
      'Cluster: nhóm tài nguyên để chạy task/service.',
      'Task definition: "bản thiết kế" container (image, CPU, RAM, port, env). Mỗi lần đăng ký tạo revision mới.',
      'Task: một lần chạy của task definition. Service: giữ N task luôn chạy, tự thay task lỗi.',
      'Fargate: không quản lý máy chủ; EC2: tự quản lý instance. awsvpc cần subnet + security group.',
    ],
    resources: [
      {
        id: 'clusters',
        label: 'Clusters',
        listCli: 'aws ecs list-clusters',
        columns: [
          { key: 'name', label: 'Cluster' },
          { key: 'status', label: 'Status' },
          { key: 'services', label: 'Services' },
          { key: 'tasks', label: 'Running tasks' },
        ],
        list: async (res) => {
          const arns = (await ecs(res).send(new ListClustersCommand({}))).clusterArns || [];
          const rows: Row[] = [];
          for (const part of chunk(arns, 100))
            for (const c of (await ecs(res).send(new DescribeClustersCommand({ clusters: part }))).clusters || [])
              rows.push({ id: c.clusterName!, name: c.clusterName, status: c.status, services: c.activeServicesCount, tasks: c.runningTasksCount, raw: c });
          return rows;
        },
        create: {
          fields: [{ key: 'name', label: 'Cluster name', required: true, placeholder: 'dev-cluster' }],
          cli: 'aws ecs create-cluster --cluster-name {name}',
          run: (res, b) => ecs(res).send(new CreateClusterCommand({ clusterName: b.name })),
        },
        removeCli: 'aws ecs delete-cluster --cluster {id}',
        remove: (res, id) => ecs(res).send(new DeleteClusterCommand({ cluster: id })),
      },
      {
        id: 'task-definitions',
        label: 'Task definitions',
        description: 'Bản thiết kế container. Đăng ký lại cùng family sẽ tăng revision.',
        listCli: 'aws ecs list-task-definitions',
        columns: [
          { key: 'family', label: 'Family' },
          { key: 'revision', label: 'Revision' },
          { key: 'status', label: 'Status' },
          { key: 'compat', label: 'Compatibility' },
          { key: 'size', label: 'CPU / Memory' },
        ],
        list: async (res) => {
          const arns = (await ecs(res).send(new ListTaskDefinitionsCommand({ maxResults: 100 }))).taskDefinitionArns || [];
          const rows: Row[] = [];
          for (const a of arns) {
            const t = (await ecs(res).send(new DescribeTaskDefinitionCommand({ taskDefinition: a }))).taskDefinition;
            if (t) rows.push({ id: a, family: t.family, revision: t.revision, status: t.status, compat: (t.requiresCompatibilities || []).join(', ') || 'EC2', size: `${t.cpu ?? '-'} / ${t.memory ?? '-'}`, raw: t });
          }
          return rows;
        },
        create: {
          fields: [
            { key: 'family', label: 'Family', required: true, placeholder: 'web-app' },
            { key: 'image', label: 'Container image', required: true, default: 'nginx:latest', hint: 'Hoặc URI ECR: <acct>.dkr.ecr.<region>.amazonaws.com/repo:tag' },
            { key: 'compat', label: 'Launch type', options: ['FARGATE', 'EC2'] },
            { key: 'cpu', label: 'CPU units', default: '256', hint: '256 = 0.25 vCPU' },
            { key: 'memory', label: 'Memory (MiB)', default: '512' },
            { key: 'port', label: 'Container port', default: '80' },
          ],
          cli: 'aws ecs register-task-definition --family {family} --requires-compatibilities {compat} --network-mode awsvpc --cpu {cpu} --memory {memory} --container-definitions file://containers.json',
          run: (res, b) =>
            ecs(res).send(new RegisterTaskDefinitionCommand({
              family: b.family,
              requiresCompatibilities: [b.compat as any],
              networkMode: b.compat === 'FARGATE' ? 'awsvpc' : 'bridge',
              cpu: b.cpu || undefined,
              memory: b.memory || undefined,
              containerDefinitions: [{ name: b.family, image: b.image, essential: true, portMappings: b.port ? [{ containerPort: num(b.port, 80) }] : undefined }],
            })),
        },
        removeCli: 'aws ecs deregister-task-definition --task-definition {id}',
        remove: (res, id) => ecs(res).send(new DeregisterTaskDefinitionCommand({ taskDefinition: id })),
        actions: [
          {
            id: 'run-task', label: 'Run task', description: 'Chạy một lần (batch job). EC2 launch type cần container instance đã đăng ký vào cluster; để học nhanh hãy dùng FARGATE kèm subnet.',
            fields: [
              { key: 'cluster', label: 'Cluster', required: true, default: 'default' },
              { key: 'count', label: 'Count', default: '1' },
              { key: 'launchType', label: 'Launch type', options: ['FARGATE', 'EC2'] },
              { key: 'subnets', label: 'Subnet IDs (phẩy)', hint: 'Cần với awsvpc/Fargate. Lấy ở EC2 → Subnets.' },
              { key: 'securityGroups', label: 'Security group IDs (phẩy)' },
            ],
            cli: 'aws ecs run-task --cluster {cluster} --task-definition {id} --count {count} --launch-type {launchType} --network-configuration "awsvpcConfiguration={subnets=[{subnets}],securityGroups=[{securityGroups}]}"',
            run: (res, id, b) =>
              ecsQuirk(ecs(res).send(new RunTaskCommand({
                cluster: b.cluster, taskDefinition: id, count: num(b.count, 1), launchType: b.launchType as any,
                networkConfiguration: b.subnets ? { awsvpcConfiguration: { subnets: csv(b.subnets), securityGroups: csv(b.securityGroups), assignPublicIp: 'ENABLED' } } : undefined,
              }))),
          },
        ],
      },
      {
        id: 'services',
        label: 'Services',
        description: 'Giữ đủ N task luôn chạy; thay task lỗi và rolling-update khi đổi task definition.',
        listCli: 'aws ecs list-services --cluster <cluster>',
        columns: [
          { key: 'name', label: 'Service' },
          { key: 'cluster', label: 'Cluster' },
          { key: 'status', label: 'Status' },
          { key: 'desired', label: 'Desired' },
          { key: 'running', label: 'Running' },
          { key: 'taskDef', label: 'Task definition' },
        ],
        list: async (res) => {
          const rows: Row[] = [];
          for (const ca of (await ecs(res).send(new ListClustersCommand({}))).clusterArns || []) {
            const cluster = tail(ca)!;
            const arns = (await ecs(res).send(new ListServicesCommand({ cluster }))).serviceArns || [];
            for (const part of chunk(arns, 10)) {
              try {
                for (const s of (await ecs(res).send(new DescribeServicesCommand({ cluster, services: part }))).services || [])
                  rows.push({ id: `${cluster}|${s.serviceName}`, name: s.serviceName, cluster, status: s.status, desired: s.desiredCount, running: s.runningCount, taskDef: tail(s.taskDefinition), raw: s });
              } catch {
                // Emulator trả timestamp SDK không parse được → chỉ hiển thị tên từ ListServices
                for (const a of part) rows.push({ id: `${cluster}|${tail(a)}`, name: tail(a), cluster, status: '-', desired: '-', running: '-', taskDef: '-', raw: { serviceArn: a, note: 'DescribeServices lỗi do định dạng timestamp của emulator' } });
              }
            }
          }
          return rows;
        },
        create: {
          fields: [
            { key: 'cluster', label: 'Cluster', required: true, default: 'default' },
            { key: 'name', label: 'Service name', required: true, placeholder: 'web-svc' },
            { key: 'taskDef', label: 'Task definition', required: true, placeholder: 'web-app:1', hint: 'family:revision (xem tab Task definitions).' },
            { key: 'desired', label: 'Desired count', default: '1' },
            { key: 'launchType', label: 'Launch type', options: ['FARGATE', 'EC2'] },
            { key: 'subnets', label: 'Subnet IDs (phẩy)', hint: 'Cần với awsvpc/Fargate.' },
            { key: 'securityGroups', label: 'Security group IDs (phẩy)' },
          ],
          cli: 'aws ecs create-service --cluster {cluster} --service-name {name} --task-definition {taskDef} --desired-count {desired} --launch-type {launchType} --network-configuration "awsvpcConfiguration={subnets=[{subnets}],securityGroups=[{securityGroups}]}"',
          run: (res, b) =>
            ecsQuirk(ecs(res).send(new CreateServiceCommand({
              cluster: b.cluster, serviceName: b.name, taskDefinition: b.taskDef, desiredCount: num(b.desired, 1), launchType: b.launchType as any,
              networkConfiguration: b.subnets ? { awsvpcConfiguration: { subnets: csv(b.subnets), securityGroups: csv(b.securityGroups), assignPublicIp: 'ENABLED' } } : undefined,
            }))),
        },
        removeCli: 'aws ecs delete-service --cluster <cluster> --service <service> --force',
        remove: (res, id) => {
          const [cluster, service] = id.split('|');
          return ecsQuirk(ecs(res).send(new DeleteServiceCommand({ cluster, service, force: true })));
        },
        actions: [
          {
            id: 'scale', label: 'Scale', description: 'Đổi số task mong muốn (scale out / in).',
            fields: [{ key: 'desired', label: 'Desired count', required: true, default: '2' }],
            cli: 'aws ecs update-service --cluster <cluster> --service <service> --desired-count {desired}',
            run: (res, id, b) => {
              const [cluster, service] = id.split('|');
              return ecsQuirk(ecs(res).send(new UpdateServiceCommand({ cluster, service, desiredCount: num(b.desired, 1) })));
            },
          },
          {
            id: 'redeploy', label: 'Force new deployment', description: 'Khởi động lại task để kéo image mới (cùng tag).',
            cli: 'aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment',
            run: (res, id) => {
              const [cluster, service] = id.split('|');
              return ecsQuirk(ecs(res).send(new UpdateServiceCommand({ cluster, service, forceNewDeployment: true })));
            },
          },
          {
            id: 'set-task-def', label: 'Update task definition', description: 'Triển khai revision mới (rolling update).',
            fields: [{ key: 'taskDef', label: 'Task definition', required: true, placeholder: 'web-app:2' }],
            cli: 'aws ecs update-service --cluster <cluster> --service <service> --task-definition {taskDef}',
            run: (res, id, b) => {
              const [cluster, service] = id.split('|');
              return ecsQuirk(ecs(res).send(new UpdateServiceCommand({ cluster, service, taskDefinition: b.taskDef })));
            },
          },
        ],
      },
      {
        id: 'tasks',
        label: 'Tasks',
        listCli: 'aws ecs list-tasks --cluster <cluster>',
        columns: [
          { key: 'task', label: 'Task' },
          { key: 'cluster', label: 'Cluster' },
          { key: 'status', label: 'Last status' },
          { key: 'desired', label: 'Desired status' },
          { key: 'taskDef', label: 'Task definition' },
        ],
        list: async (res) => {
          const rows: Row[] = [];
          for (const ca of (await ecs(res).send(new ListClustersCommand({}))).clusterArns || []) {
            const cluster = tail(ca)!;
            const arns = (await ecs(res).send(new ListTasksCommand({ cluster }))).taskArns || [];
            for (const part of chunk(arns, 100)) {
              try {
                for (const t of (await ecs(res).send(new DescribeTasksCommand({ cluster, tasks: part }))).tasks || [])
                  rows.push({ id: `${cluster}|${t.taskArn}`, task: tail(t.taskArn), cluster, status: t.lastStatus, desired: t.desiredStatus, taskDef: tail(t.taskDefinitionArn), raw: t });
              } catch {
                for (const a of part) rows.push({ id: `${cluster}|${a}`, task: tail(a), cluster, status: '-', desired: '-', taskDef: '-', raw: { taskArn: a, note: 'DescribeTasks lỗi do định dạng timestamp của emulator' } });
              }
            }
          }
          return rows;
        },
        actions: [
          {
            id: 'stop', label: 'Stop task', danger: true,
            cli: 'aws ecs stop-task --cluster <cluster> --task <taskArn>',
            run: (res, id) => {
              const i = id.indexOf('|');
              return ecsQuirk(ecs(res).send(new StopTaskCommand({ cluster: id.slice(0, i), task: id.slice(i + 1), reason: 'Stopped from AWS Local Console' })));
            },
          },
        ],
      },
    ],
  },
];

void bad;

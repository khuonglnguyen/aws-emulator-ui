import {
  ListStreamsCommand, DescribeStreamSummaryCommand, CreateStreamCommand, DeleteStreamCommand, PutRecordCommand, ListShardsCommand,
  GetShardIteratorCommand, GetRecordsCommand, IncreaseStreamRetentionPeriodCommand, DecreaseStreamRetentionPeriodCommand,
} from '@aws-sdk/client-kinesis';
import {
  DescribeDBInstancesCommand, CreateDBInstanceCommand, DeleteDBInstanceCommand, StartDBInstanceCommand, StopDBInstanceCommand,
  RebootDBInstanceCommand, CreateDBSnapshotCommand, ModifyDBInstanceCommand, DescribeDBSnapshotsCommand, DeleteDBSnapshotCommand,
  RestoreDBInstanceFromDBSnapshotCommand, DescribeDBSubnetGroupsCommand, CreateDBSubnetGroupCommand, DeleteDBSubnetGroupCommand,
  DescribeDBParameterGroupsCommand, CreateDBParameterGroupCommand, DeleteDBParameterGroupCommand, ModifyDBParameterGroupCommand,
  DescribeDBParametersCommand,
} from '@aws-sdk/client-rds';
import {
  DescribeCacheClustersCommand, CreateCacheClusterCommand, DeleteCacheClusterCommand, ModifyCacheClusterCommand, CreateSnapshotCommand,
  DescribeReplicationGroupsCommand, CreateReplicationGroupCommand, DeleteReplicationGroupCommand, ModifyReplicationGroupCommand,
  DescribeSnapshotsCommand, DeleteSnapshotCommand,
} from '@aws-sdk/client-elasticache';
import {
  ListDistributionsCommand, CreateDistributionCommand, GetDistributionConfigCommand, UpdateDistributionCommand, DeleteDistributionCommand,
  GetDistributionCommand, CreateInvalidationCommand, ListInvalidationsCommand, ListCachePoliciesCommand, CreateCachePolicyCommand, GetCachePolicyCommand,
  DeleteCachePolicyCommand, ListOriginAccessControlsCommand, CreateOriginAccessControlCommand, GetOriginAccessControlCommand,
  DeleteOriginAccessControlCommand,
} from '@aws-sdk/client-cloudfront';
import { kinesis, rds, elasticache, cloudfront } from '../aws';
import { Service, Row, bad, date, tail, num, csv } from './infra.types';

const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';

/** CloudFront yêu cầu ETag (If-Match) khi sửa/xóa */
async function setEnabled(res: any, id: string, enabled: boolean) {
  const g = await cloudfront(res).send(new GetDistributionConfigCommand({ Id: id }));
  if (!g.DistributionConfig) throw bad('Không đọc được cấu hình distribution');
  if (g.DistributionConfig.Enabled === enabled) return { ETag: g.ETag, unchanged: true };
  return cloudfront(res).send(new UpdateDistributionCommand({ Id: id, IfMatch: g.ETag, DistributionConfig: { ...g.DistributionConfig, Enabled: enabled } }));
}

/** Sau khi disable, CloudFront cần deploy xong (Status = Deployed) mới cho xóa */
async function waitDeployed(res: any, id: string, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const s = (await cloudfront(res).send(new GetDistributionCommand({ Id: id }))).Distribution?.Status;
    if (s === 'Deployed') return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export const DATA_SERVICES: Service[] = [
  /* ───────────────────────────── Kinesis ───────────────────────────── */
  {
    id: 'kinesis',
    label: 'Amazon Kinesis',
    description: 'Thu thập và xử lý dòng dữ liệu thời gian thực (log, click, sensor). Nhiều producer ghi, nhiều consumer đọc độc lập. Stream mới ở trạng thái CREATING vài giây; chờ ACTIVE (bấm Refresh) mới put/get record được.',
    concepts: [
      'Stream gồm các shard; mỗi shard ≈ 1 MB/s ghi, 2 MB/s đọc.',
      'Partition key quyết định record vào shard nào; cùng key = cùng shard = giữ thứ tự.',
      'Record được giữ theo retention (mặc định 24h), đọc lại được bằng shard iterator.',
      'On-demand: tự co giãn; Provisioned: tự chọn số shard.',
    ],
    resources: [
      {
        id: 'streams',
        label: 'Data streams',
        listCli: 'aws kinesis list-streams',
        columns: [
          { key: 'name', label: 'Stream' },
          { key: 'status', label: 'Status' },
          { key: 'mode', label: 'Capacity mode' },
          { key: 'shards', label: 'Open shards' },
          { key: 'retention', label: 'Retention (h)' },
        ],
        list: async (res) => {
          const names = (await kinesis(res).send(new ListStreamsCommand({}))).StreamNames || [];
          const rows: Row[] = [];
          for (const n of names) {
            const d = (await kinesis(res).send(new DescribeStreamSummaryCommand({ StreamName: n }))).StreamDescriptionSummary;
            rows.push({ id: n, name: n, status: d?.StreamStatus, mode: d?.StreamModeDetails?.StreamMode ?? 'PROVISIONED', shards: d?.OpenShardCount, retention: d?.RetentionPeriodHours, raw: d });
          }
          return rows;
        },
        create: {
          fields: [
            { key: 'name', label: 'Stream name', required: true, placeholder: 'clickstream' },
            { key: 'mode', label: 'Capacity mode', options: ['PROVISIONED', 'ON_DEMAND'] },
            { key: 'shards', label: 'Shard count (Provisioned)', default: '1' },
          ],
          cli: 'aws kinesis create-stream --stream-name {name} --shard-count {shards}',
          run: (res, b) =>
            kinesis(res).send(new CreateStreamCommand({
              StreamName: b.name,
              StreamModeDetails: { StreamMode: b.mode as any },
              ...(b.mode === 'PROVISIONED' ? { ShardCount: num(b.shards, 1) } : {}),
            })),
        },
        removeCli: 'aws kinesis delete-stream --stream-name {id} --enforce-consumer-deletion',
        remove: (res, id) => kinesis(res).send(new DeleteStreamCommand({ StreamName: id, EnforceConsumerDeletion: true })),
        actions: [
          {
            id: 'put-record', label: 'Put record', description: 'Ghi một record. Cùng partition key luôn vào cùng shard.',
            fields: [
              { key: 'key', label: 'Partition key', required: true, default: 'user-1' },
              { key: 'data', label: 'Data', multiline: true, required: true, default: '{"event":"page_view","page":"/home"}' },
            ],
            cli: "aws kinesis put-record --stream-name {id} --partition-key {key} --data '{data}' --cli-binary-format raw-in-base64-out",
            run: (res, id, b) =>
              kinesis(res).send(new PutRecordCommand({ StreamName: id, PartitionKey: b.key, Data: Buffer.from(b.data, 'utf8') })),
          },
          {
            id: 'get-records', label: 'Get records', description: 'Đọc từ đầu (TRIM_HORIZON) trên mọi shard. Dữ liệu được giải mã thành text.',
            fields: [{ key: 'limit', label: 'Limit / shard', default: '10' }],
            cli: 'aws kinesis get-shard-iterator --stream-name {id} --shard-id <shardId> --shard-iterator-type TRIM_HORIZON  &&  aws kinesis get-records --shard-iterator <iterator> --limit {limit}',
            run: async (res, id, b) => {
              const out: unknown[] = [];
              for (const sh of (await kinesis(res).send(new ListShardsCommand({ StreamName: id }))).Shards || []) {
                const it = (await kinesis(res).send(new GetShardIteratorCommand({ StreamName: id, ShardId: sh.ShardId, ShardIteratorType: 'TRIM_HORIZON' }))).ShardIterator;
                const r = await kinesis(res).send(new GetRecordsCommand({ ShardIterator: it, Limit: num(b.limit, 10) }));
                for (const rec of r.Records || [])
                  out.push({ shard: sh.ShardId, sequence: rec.SequenceNumber, partitionKey: rec.PartitionKey, arrival: date(rec.ApproximateArrivalTimestamp), data: rec.Data ? Buffer.from(rec.Data).toString('utf8') : '' });
              }
              return out;
            },
          },
          {
            id: 'list-shards', label: 'List shards', cli: 'aws kinesis list-shards --stream-name {id}',
            run: async (res, id) => (await kinesis(res).send(new ListShardsCommand({ StreamName: id }))).Shards,
          },
          {
            id: 'set-retention', label: 'Set retention', description: 'Thời gian giữ record: 24h → tối đa 8760h (365 ngày).',
            fields: [{ key: 'hours', label: 'Retention (giờ)', required: true, default: '48' }],
            cli: 'aws kinesis increase-stream-retention-period --stream-name {id} --retention-period-hours {hours}',
            run: async (res, id, b) => {
              const cur = (await kinesis(res).send(new DescribeStreamSummaryCommand({ StreamName: id }))).StreamDescriptionSummary?.RetentionPeriodHours ?? 24;
              const hours = num(b.hours, 24);
              if (hours === cur) return { message: `Đã là ${cur}h` };
              return hours > cur
                ? kinesis(res).send(new IncreaseStreamRetentionPeriodCommand({ StreamName: id, RetentionPeriodHours: hours }))
                : kinesis(res).send(new DecreaseStreamRetentionPeriodCommand({ StreamName: id, RetentionPeriodHours: hours }));
            },
          },
        ],
      },
    ],
  },

  /* ───────────────────────────── RDS ───────────────────────────── */
  {
    id: 'rds',
    label: 'Amazon RDS',
    description: 'Database quan hệ được quản lý (MySQL, PostgreSQL, MariaDB…). AWS lo backup, vá lỗi, failover. Instance mới ở trạng thái creating; chờ available (bấm Refresh) mới snapshot/stop/reboot được.',
    concepts: [
      'DB instance: một máy chủ database (engine + class + storage).',
      'Snapshot: bản sao lưu; có thể restore thành instance mới.',
      'Subnet group: các subnet (≥2 AZ) mà instance được đặt vào.',
      'Parameter group: cấu hình engine (vd max_connections) dùng chung cho nhiều instance.',
      'Endpoint: hostname:port để ứng dụng kết nối (cùng chuỗi kết nối bình thường).',
    ],
    resources: [
      {
        id: 'instances',
        label: 'DB instances',
        listCli: 'aws rds describe-db-instances',
        columns: [
          { key: 'name', label: 'Identifier' },
          { key: 'engine', label: 'Engine' },
          { key: 'cls', label: 'Class' },
          { key: 'status', label: 'Status' },
          { key: 'endpoint', label: 'Endpoint' },
        ],
        list: async (res) =>
          ((await rds(res).send(new DescribeDBInstancesCommand({}))).DBInstances || []).map((d) => ({
            id: d.DBInstanceIdentifier!, name: d.DBInstanceIdentifier, engine: `${d.Engine} ${d.EngineVersion ?? ''}`.trim(), cls: d.DBInstanceClass, status: d.DBInstanceStatus,
            endpoint: d.Endpoint ? `${d.Endpoint.Address}:${d.Endpoint.Port}` : '', raw: d,
          })),
        create: {
          fields: [
            { key: 'id', label: 'DB identifier', required: true, placeholder: 'app-db' },
            { key: 'engine', label: 'Engine', options: ['mysql', 'postgres', 'mariadb'] },
            { key: 'cls', label: 'Instance class', options: ['db.t3.micro', 'db.t3.small', 'db.t3.medium'] },
            { key: 'user', label: 'Master username', required: true, default: 'admin' },
            { key: 'password', label: 'Master password', required: true, default: 'Passw0rd-learn', hint: 'Tối thiểu 8 ký tự. Chỉ dùng giá trị test.' },
            { key: 'storage', label: 'Storage (GB)', default: '20' },
            { key: 'dbName', label: 'Initial database (tuỳ chọn)', placeholder: 'appdb' },
          ],
          cli: 'aws rds create-db-instance --db-instance-identifier {id} --engine {engine} --db-instance-class {cls} --master-username {user} --master-user-password <password> --allocated-storage {storage}',
          run: (res, b) =>
            rds(res).send(new CreateDBInstanceCommand({
              DBInstanceIdentifier: b.id, Engine: b.engine, DBInstanceClass: b.cls, MasterUsername: b.user, MasterUserPassword: b.password,
              AllocatedStorage: num(b.storage, 20), DBName: b.dbName || undefined,
            })),
        },
        removeCli: 'aws rds delete-db-instance --db-instance-identifier {id} --skip-final-snapshot',
        remove: (res, id) => rds(res).send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true })),
        actions: [
          { id: 'stop', label: 'Stop', description: 'Tạm dừng (không tính phí compute).', cli: 'aws rds stop-db-instance --db-instance-identifier {id}', run: (res, id) => rds(res).send(new StopDBInstanceCommand({ DBInstanceIdentifier: id })) },
          { id: 'start', label: 'Start', cli: 'aws rds start-db-instance --db-instance-identifier {id}', run: (res, id) => rds(res).send(new StartDBInstanceCommand({ DBInstanceIdentifier: id })) },
          { id: 'reboot', label: 'Reboot', cli: 'aws rds reboot-db-instance --db-instance-identifier {id}', run: (res, id) => rds(res).send(new RebootDBInstanceCommand({ DBInstanceIdentifier: id })) },
          {
            id: 'snapshot', label: 'Create snapshot', description: 'Sao lưu thủ công; giữ cho đến khi bạn xóa.',
            fields: [{ key: 'snapshot', label: 'Snapshot name', required: true, placeholder: 'app-db-before-migration' }],
            cli: 'aws rds create-db-snapshot --db-instance-identifier {id} --db-snapshot-identifier {snapshot}',
            run: (res, id, b) => rds(res).send(new CreateDBSnapshotCommand({ DBInstanceIdentifier: id, DBSnapshotIdentifier: b.snapshot })),
          },
          {
            id: 'resize', label: 'Change class / storage', description: 'Scale up khi thiếu CPU/RAM. Áp dụng ngay (ApplyImmediately).',
            fields: [
              { key: 'cls', label: 'Instance class', options: ['db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.t3.large'] },
              { key: 'storage', label: 'Storage (GB, tuỳ chọn)', hint: 'Chỉ tăng được, không giảm.' },
            ],
            cli: 'aws rds modify-db-instance --db-instance-identifier {id} --db-instance-class {cls} --allocated-storage {storage} --apply-immediately',
            run: (res, id, b) =>
              rds(res).send(new ModifyDBInstanceCommand({
                DBInstanceIdentifier: id, DBInstanceClass: b.cls, AllocatedStorage: b.storage ? num(b.storage, 20) : undefined, ApplyImmediately: true,
              })),
          },
        ],
      },
      {
        id: 'snapshots',
        label: 'Snapshots',
        listCli: 'aws rds describe-db-snapshots',
        columns: [
          { key: 'name', label: 'Snapshot' },
          { key: 'instance', label: 'Source instance' },
          { key: 'status', label: 'Status' },
          { key: 'type', label: 'Type' },
          { key: 'created', label: 'Created' },
        ],
        list: async (res) =>
          ((await rds(res).send(new DescribeDBSnapshotsCommand({}))).DBSnapshots || []).map((s) => ({
            id: s.DBSnapshotIdentifier!, name: s.DBSnapshotIdentifier, instance: s.DBInstanceIdentifier, status: s.Status, type: s.SnapshotType, created: date(s.SnapshotCreateTime), raw: s,
          })),
        removeCli: 'aws rds delete-db-snapshot --db-snapshot-identifier {id}',
        remove: (res, id) => rds(res).send(new DeleteDBSnapshotCommand({ DBSnapshotIdentifier: id })),
        actions: [
          {
            id: 'restore', label: 'Restore to new instance', description: 'Restore luôn tạo instance MỚI, không ghi đè instance cũ.',
            fields: [{ key: 'newId', label: 'New DB identifier', required: true, placeholder: 'app-db-restored' }],
            cli: 'aws rds restore-db-instance-from-db-snapshot --db-instance-identifier {newId} --db-snapshot-identifier {id}',
            run: (res, id, b) => rds(res).send(new RestoreDBInstanceFromDBSnapshotCommand({ DBInstanceIdentifier: b.newId, DBSnapshotIdentifier: id })),
          },
        ],
      },
      {
        id: 'subnet-groups',
        label: 'Subnet groups',
        description: 'Tập subnet (thuộc ≥2 AZ) cho RDS. Lấy Subnet ID ở EC2 / VPC → Subnets.',
        listCli: 'aws rds describe-db-subnet-groups',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'vpc', label: 'VPC' },
          { key: 'status', label: 'Status' },
          { key: 'subnets', label: 'Subnets' },
        ],
        list: async (res) =>
          ((await rds(res).send(new DescribeDBSubnetGroupsCommand({}))).DBSubnetGroups || []).map((g) => ({
            id: g.DBSubnetGroupName!, name: g.DBSubnetGroupName, vpc: g.VpcId, status: g.SubnetGroupStatus, subnets: (g.Subnets || []).length, raw: g,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Name', required: true, placeholder: 'app-subnets' },
            { key: 'description', label: 'Description', required: true, default: 'App DB subnets' },
            { key: 'subnetIds', label: 'Subnet IDs (phẩy)', required: true, placeholder: 'subnet-aaa,subnet-bbb' },
          ],
          cli: 'aws rds create-db-subnet-group --db-subnet-group-name {name} --db-subnet-group-description "{description}" --subnet-ids {subnetIds}',
          run: (res, b) => rds(res).send(new CreateDBSubnetGroupCommand({ DBSubnetGroupName: b.name, DBSubnetGroupDescription: b.description, SubnetIds: csv(b.subnetIds) })),
        },
        removeCli: 'aws rds delete-db-subnet-group --db-subnet-group-name {id}',
        remove: (res, id) => rds(res).send(new DeleteDBSubnetGroupCommand({ DBSubnetGroupName: id })),
      },
      {
        id: 'parameter-groups',
        label: 'Parameter groups',
        description: 'Cấu hình engine dùng chung (vd max_connections, character_set_server).',
        listCli: 'aws rds describe-db-parameter-groups',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'family', label: 'Family' },
          { key: 'description', label: 'Description' },
        ],
        list: async (res) =>
          ((await rds(res).send(new DescribeDBParameterGroupsCommand({}))).DBParameterGroups || []).map((g) => ({
            id: g.DBParameterGroupName!, name: g.DBParameterGroupName, family: g.DBParameterGroupFamily, description: g.Description, raw: g,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Name', required: true, placeholder: 'app-mysql-params' },
            { key: 'family', label: 'Family', options: ['mysql8.0', 'postgres16', 'mariadb10.11'] },
            { key: 'description', label: 'Description', required: true, default: 'Custom parameters' },
          ],
          cli: 'aws rds create-db-parameter-group --db-parameter-group-name {name} --db-parameter-group-family {family} --description "{description}"',
          run: (res, b) => rds(res).send(new CreateDBParameterGroupCommand({ DBParameterGroupName: b.name, DBParameterGroupFamily: b.family, Description: b.description })),
        },
        removeCli: 'aws rds delete-db-parameter-group --db-parameter-group-name {id}',
        remove: (res, id) => rds(res).send(new DeleteDBParameterGroupCommand({ DBParameterGroupName: id })),
        actions: [
          {
            id: 'set-parameter', label: 'Set parameter',
            fields: [
              { key: 'param', label: 'Parameter name', required: true, default: 'max_connections' },
              { key: 'value', label: 'Value', required: true, default: '200' },
              { key: 'apply', label: 'Apply method', options: ['immediate', 'pending-reboot'] },
            ],
            cli: 'aws rds modify-db-parameter-group --db-parameter-group-name {id} --parameters "ParameterName={param},ParameterValue={value},ApplyMethod={apply}"',
            run: (res, id, b) =>
              rds(res).send(new ModifyDBParameterGroupCommand({ DBParameterGroupName: id, Parameters: [{ ParameterName: b.param, ParameterValue: b.value, ApplyMethod: b.apply as any }] })),
          },
          {
            id: 'list-parameters', label: 'List parameters', description: 'Hiện 100 parameter đầu tiên.',
            cli: 'aws rds describe-db-parameters --db-parameter-group-name {id}',
            run: async (res, id) => (await rds(res).send(new DescribeDBParametersCommand({ DBParameterGroupName: id, MaxRecords: 100 }))).Parameters,
          },
        ],
      },
    ],
  },

  /* ───────────────────────────── ElastiCache ───────────────────────────── */
  {
    id: 'elasticache',
    label: 'Amazon ElastiCache',
    description: 'Cache trong bộ nhớ (Redis/Memcached) để giảm tải database và trả lời trong mili-giây. Cluster mới ở trạng thái creating; chờ available mới thao tác được. Lưu ý: emulator hiện chưa hỗ trợ DeleteReplicationGroup (xóa replication group sẽ báo lỗi, cần restart emulator để dọn).',
    concepts: [
      'Cache-aside: app đọc cache trước, miss thì đọc DB rồi ghi lại cache (kèm TTL).',
      'Redis: kiểu dữ liệu phong phú, replication, snapshot. Memcached: đơn giản, nhiều node, không lưu bền.',
      'Replication group: 1 primary + các replica, tự failover.',
    ],
    resources: [
      {
        id: 'clusters',
        label: 'Cache clusters',
        listCli: 'aws elasticache describe-cache-clusters',
        columns: [
          { key: 'name', label: 'Cluster' },
          { key: 'engine', label: 'Engine' },
          { key: 'nodeType', label: 'Node type' },
          { key: 'nodes', label: 'Nodes' },
          { key: 'status', label: 'Status' },
        ],
        list: async (res) =>
          ((await elasticache(res).send(new DescribeCacheClustersCommand({}))).CacheClusters || []).map((c) => ({
            id: c.CacheClusterId!, name: c.CacheClusterId, engine: `${c.Engine} ${c.EngineVersion ?? ''}`.trim(), nodeType: c.CacheNodeType, nodes: c.NumCacheNodes, status: c.CacheClusterStatus, raw: c,
          })),
        create: {
          fields: [
            { key: 'id', label: 'Cluster ID', required: true, placeholder: 'session-cache' },
            { key: 'engine', label: 'Engine', options: ['redis', 'memcached'] },
            { key: 'nodeType', label: 'Node type', options: ['cache.t3.micro', 'cache.t3.small', 'cache.t3.medium'] },
            { key: 'nodes', label: 'Số node', default: '1', hint: 'Redis cluster đơn: 1. Memcached: 1–40.' },
          ],
          cli: 'aws elasticache create-cache-cluster --cache-cluster-id {id} --engine {engine} --cache-node-type {nodeType} --num-cache-nodes {nodes}',
          run: (res, b) =>
            elasticache(res).send(new CreateCacheClusterCommand({ CacheClusterId: b.id, Engine: b.engine, CacheNodeType: b.nodeType, NumCacheNodes: num(b.nodes, 1) })),
        },
        removeCli: 'aws elasticache delete-cache-cluster --cache-cluster-id {id}',
        remove: (res, id) => elasticache(res).send(new DeleteCacheClusterCommand({ CacheClusterId: id })),
        actions: [
          {
            id: 'scale-nodes', label: 'Change node count', description: 'Chỉ áp dụng cho Memcached (scale ngang).',
            fields: [{ key: 'nodes', label: 'Số node', required: true, default: '2' }],
            cli: 'aws elasticache modify-cache-cluster --cache-cluster-id {id} --num-cache-nodes {nodes} --apply-immediately',
            run: (res, id, b) => elasticache(res).send(new ModifyCacheClusterCommand({ CacheClusterId: id, NumCacheNodes: num(b.nodes, 1), ApplyImmediately: true })),
          },
          {
            id: 'snapshot', label: 'Create snapshot', description: 'Sao lưu cluster Redis.',
            fields: [{ key: 'snapshot', label: 'Snapshot name', required: true, placeholder: 'cache-backup-1' }],
            cli: 'aws elasticache create-snapshot --cache-cluster-id {id} --snapshot-name {snapshot}',
            run: (res, id, b) => elasticache(res).send(new CreateSnapshotCommand({ CacheClusterId: id, SnapshotName: b.snapshot })),
          },
        ],
      },
      {
        id: 'replication-groups',
        label: 'Replication groups',
        description: 'Redis có replica để chịu lỗi và scale đọc.',
        listCli: 'aws elasticache describe-replication-groups',
        columns: [
          { key: 'name', label: 'Group' },
          { key: 'status', label: 'Status' },
          { key: 'members', label: 'Members' },
          { key: 'failover', label: 'Auto failover' },
          { key: 'description', label: 'Description' },
        ],
        list: async (res) =>
          ((await elasticache(res).send(new DescribeReplicationGroupsCommand({}))).ReplicationGroups || []).map((g) => ({
            id: g.ReplicationGroupId!, name: g.ReplicationGroupId, status: g.Status, members: (g.MemberClusters || []).length, failover: g.AutomaticFailover, description: g.Description, raw: g,
          })),
        create: {
          fields: [
            { key: 'id', label: 'Group ID', required: true, placeholder: 'app-redis' },
            { key: 'description', label: 'Description', required: true, default: 'App Redis' },
            { key: 'nodeType', label: 'Node type', options: ['cache.t3.micro', 'cache.t3.small', 'cache.t3.medium'] },
            { key: 'nodes', label: 'Số node (1 primary + replicas)', default: '2' },
          ],
          cli: 'aws elasticache create-replication-group --replication-group-id {id} --replication-group-description "{description}" --engine redis --cache-node-type {nodeType} --num-cache-clusters {nodes}',
          run: (res, b) =>
            elasticache(res).send(new CreateReplicationGroupCommand({
              ReplicationGroupId: b.id, ReplicationGroupDescription: b.description, Engine: 'redis', CacheNodeType: b.nodeType, NumCacheClusters: num(b.nodes, 2),
            })),
        },
        removeCli: 'aws elasticache delete-replication-group --replication-group-id {id}',
        remove: (res, id) => elasticache(res).send(new DeleteReplicationGroupCommand({ ReplicationGroupId: id })),
        actions: [
          {
            id: 'modify', label: 'Modify description',
            fields: [{ key: 'description', label: 'Description', required: true }],
            cli: 'aws elasticache modify-replication-group --replication-group-id {id} --replication-group-description "{description}" --apply-immediately',
            run: (res, id, b) => elasticache(res).send(new ModifyReplicationGroupCommand({ ReplicationGroupId: id, ReplicationGroupDescription: b.description, ApplyImmediately: true })),
          },
        ],
      },
      {
        id: 'snapshots',
        label: 'Snapshots',
        listCli: 'aws elasticache describe-snapshots',
        columns: [
          { key: 'name', label: 'Snapshot' },
          { key: 'source', label: 'Source' },
          { key: 'status', label: 'Status' },
          { key: 'engine', label: 'Engine' },
        ],
        list: async (res) =>
          ((await elasticache(res).send(new DescribeSnapshotsCommand({}))).Snapshots || []).map((s) => ({
            id: s.SnapshotName!, name: s.SnapshotName, source: s.CacheClusterId || s.ReplicationGroupId, status: s.SnapshotStatus, engine: s.Engine, raw: s,
          })),
        removeCli: 'aws elasticache delete-snapshot --snapshot-name {id}',
        remove: (res, id) => elasticache(res).send(new DeleteSnapshotCommand({ SnapshotName: id })),
      },
    ],
  },

  /* ───────────────────────────── CloudFront ───────────────────────────── */
  {
    id: 'cloudfront',
    label: 'Amazon CloudFront',
    description: 'CDN: cache nội dung ở các edge location gần người dùng để tải nhanh và giảm tải origin (S3, ALB, API…).',
    concepts: [
      'Distribution: cấu hình CDN, có domain *.cloudfront.net.',
      'Origin: nơi lấy nội dung gốc (S3 bucket, website, ALB).',
      'Cache behavior / cache policy: cache theo path, header, query string, TTL nào.',
      'Invalidation: xóa cache trước khi hết TTL (vd /index.html hoặc /*).',
      'Origin Access Control: cho phép CloudFront đọc S3 riêng tư mà không public bucket.',
    ],
    resources: [
      {
        id: 'distributions',
        label: 'Distributions',
        listCli: 'aws cloudfront list-distributions',
        columns: [
          { key: 'distId', label: 'ID' },
          { key: 'domain', label: 'Domain' },
          { key: 'status', label: 'Status' },
          { key: 'enabled', label: 'Enabled' },
          { key: 'comment', label: 'Comment' },
        ],
        list: async (res) =>
          ((await cloudfront(res).send(new ListDistributionsCommand({}))).DistributionList?.Items || []).map((d) => ({
            id: d.Id!, distId: d.Id, domain: d.DomainName, status: d.Status, enabled: String(d.Enabled), comment: d.Comment, raw: d,
          })),
        create: {
          fields: [
            { key: 'origin', label: 'Origin domain', required: true, default: 'my-bucket.s3.amazonaws.com', hint: 'S3 (*.s3.amazonaws.com) hoặc domain website/ALB.' },
            { key: 'comment', label: 'Comment', default: 'Learning distribution' },
            { key: 'root', label: 'Default root object', default: 'index.html' },
            { key: 'viewer', label: 'Viewer protocol', options: ['redirect-to-https', 'https-only', 'allow-all'] },
          ],
          cli: 'aws cloudfront create-distribution --origin-domain-name {origin} --default-root-object {root}',
          run: (res, b) => {
            const isS3 = /\.s3[.-]/.test(b.origin);
            return cloudfront(res).send(new CreateDistributionCommand({
              DistributionConfig: {
                CallerReference: `console-${Date.now()}`,
                Comment: b.comment || '',
                Enabled: true,
                DefaultRootObject: b.root || undefined,
                Origins: {
                  Quantity: 1,
                  Items: [{
                    Id: 'origin-1', DomainName: b.origin,
                    ...(isS3
                      ? { S3OriginConfig: { OriginAccessIdentity: '' } }
                      : { CustomOriginConfig: { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: 'https-only' } }),
                  }],
                },
                DefaultCacheBehavior: { TargetOriginId: 'origin-1', ViewerProtocolPolicy: b.viewer as any, CachePolicyId: CACHING_OPTIMIZED },
              },
            }));
          },
        },
        removeCli: 'aws cloudfront delete-distribution --id {id} --if-match <ETag>   # phải disable trước',
        remove: async (res, id) => {
          await setEnabled(res, id, false);
          await waitDeployed(res, id);
          const g = await cloudfront(res).send(new GetDistributionConfigCommand({ Id: id }));
          return cloudfront(res).send(new DeleteDistributionCommand({ Id: id, IfMatch: g.ETag }));
        },
        actions: [
          {
            id: 'invalidate', label: 'Create invalidation', description: 'Xóa cache của các path (mỗi dòng một path). Dùng khi vừa deploy bản mới.',
            fields: [{ key: 'paths', label: 'Paths (mỗi dòng một path)', multiline: true, required: true, default: '/index.html\n/assets/*' }],
            cli: 'aws cloudfront create-invalidation --distribution-id {id} --paths {paths}',
            run: (res, id, b) => {
              const items = b.paths.split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean).map((p) => (p.startsWith('/') ? p : `/${p}`));
              return cloudfront(res).send(new CreateInvalidationCommand({ DistributionId: id, InvalidationBatch: { CallerReference: `inv-${Date.now()}`, Paths: { Quantity: items.length, Items: items } } }));
            },
          },
          { id: 'disable', label: 'Disable', cli: 'aws cloudfront update-distribution --id {id} --distribution-config file://config.json   # Enabled=false', run: (res, id) => setEnabled(res, id, false) },
          { id: 'enable', label: 'Enable', cli: 'aws cloudfront update-distribution --id {id} --distribution-config file://config.json   # Enabled=true', run: (res, id) => setEnabled(res, id, true) },
          {
            id: 'get-config', label: 'Xem cấu hình', cli: 'aws cloudfront get-distribution-config --id {id}',
            run: async (res, id) => (await cloudfront(res).send(new GetDistributionConfigCommand({ Id: id }))).DistributionConfig,
          },
        ],
      },
      {
        id: 'invalidations',
        label: 'Invalidations',
        description: 'Lịch sử xóa cache của mọi distribution (chỉ đọc).',
        listCli: 'aws cloudfront list-invalidations --distribution-id <id>',
        columns: [
          { key: 'invId', label: 'Invalidation' },
          { key: 'dist', label: 'Distribution' },
          { key: 'status', label: 'Status' },
          { key: 'created', label: 'Created' },
        ],
        list: async (res) => {
          const rows: Row[] = [];
          for (const d of (await cloudfront(res).send(new ListDistributionsCommand({}))).DistributionList?.Items || []) {
            for (const i of (await cloudfront(res).send(new ListInvalidationsCommand({ DistributionId: d.Id }))).InvalidationList?.Items || [])
              rows.push({ id: `${d.Id}|${i.Id}`, invId: i.Id, dist: d.Id, status: i.Status, created: date(i.CreateTime), raw: i });
          }
          return rows;
        },
      },
      {
        id: 'cache-policies',
        label: 'Cache policies',
        description: 'Quy tắc cache (TTL, header/cookie/query nào ảnh hưởng cache key). Policy "managed" do AWS cung cấp, chỉ policy custom mới xóa được.',
        listCli: 'aws cloudfront list-cache-policies',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'type', label: 'Type' },
          { key: 'ttl', label: 'Min / Default / Max TTL' },
          { key: 'comment', label: 'Comment' },
        ],
        list: async (res) =>
          ((await cloudfront(res).send(new ListCachePoliciesCommand({}))).CachePolicyList?.Items || []).map((i) => ({
            id: i.CachePolicy!.Id!, name: i.CachePolicy?.CachePolicyConfig?.Name, type: i.Type,
            ttl: `${i.CachePolicy?.CachePolicyConfig?.MinTTL} / ${i.CachePolicy?.CachePolicyConfig?.DefaultTTL ?? '-'} / ${i.CachePolicy?.CachePolicyConfig?.MaxTTL ?? '-'}`,
            comment: i.CachePolicy?.CachePolicyConfig?.Comment, raw: i.CachePolicy,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Name', required: true, placeholder: 'api-short-cache' },
            { key: 'min', label: 'Min TTL (s)', default: '0' },
            { key: 'def', label: 'Default TTL (s)', default: '60', hint: 'TTL khi origin không gửi Cache-Control.' },
            { key: 'max', label: 'Max TTL (s)', default: '3600' },
          ],
          cli: 'aws cloudfront create-cache-policy --cache-policy-config file://policy.json',
          run: (res, b) =>
            cloudfront(res).send(new CreateCachePolicyCommand({
              CachePolicyConfig: {
                Name: b.name, MinTTL: num(b.min, 0), DefaultTTL: num(b.def, 60), MaxTTL: num(b.max, 3600),
                ParametersInCacheKeyAndForwardedToOrigin: {
                  EnableAcceptEncodingGzip: true, EnableAcceptEncodingBrotli: true,
                  HeadersConfig: { HeaderBehavior: 'none' }, CookiesConfig: { CookieBehavior: 'none' }, QueryStringsConfig: { QueryStringBehavior: 'none' },
                },
              },
            })),
        },
        removeCli: 'aws cloudfront delete-cache-policy --id {id} --if-match <ETag>',
        remove: async (res, id) => {
          const g = await cloudfront(res).send(new GetCachePolicyCommand({ Id: id }));
          return cloudfront(res).send(new DeleteCachePolicyCommand({ Id: id, IfMatch: g.ETag }));
        },
      },
      {
        id: 'origin-access-controls',
        label: 'Origin access controls',
        description: 'Cho CloudFront ký request (SigV4) để đọc S3 riêng tư. Gắn OAC vào origin rồi chặn truy cập public vào bucket.',
        listCli: 'aws cloudfront list-origin-access-controls',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'oacId', label: 'ID' },
          { key: 'origin', label: 'Origin type' },
          { key: 'signing', label: 'Signing' },
        ],
        list: async (res) =>
          ((await cloudfront(res).send(new ListOriginAccessControlsCommand({}))).OriginAccessControlList?.Items || []).map((o) => ({
            id: o.Id!, name: o.Name, oacId: o.Id, origin: o.OriginAccessControlOriginType, signing: `${o.SigningBehavior} / ${o.SigningProtocol}`, raw: o,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Name', required: true, placeholder: 'my-bucket-oac' },
            { key: 'description', label: 'Description' },
            { key: 'origin', label: 'Origin type', options: ['s3', 'mediastore', 'lambda', 'mediapackagev2'] },
          ],
          cli: 'aws cloudfront create-origin-access-control --origin-access-control-config Name={name},SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType={origin}',
          run: (res, b) =>
            cloudfront(res).send(new CreateOriginAccessControlCommand({
              OriginAccessControlConfig: { Name: b.name, Description: b.description || undefined, SigningProtocol: 'sigv4', SigningBehavior: 'always', OriginAccessControlOriginType: b.origin as any },
            })),
        },
        removeCli: 'aws cloudfront delete-origin-access-control --id {id} --if-match <ETag>',
        remove: async (res, id) => {
          const g = await cloudfront(res).send(new GetOriginAccessControlCommand({ Id: id }));
          return cloudfront(res).send(new DeleteOriginAccessControlCommand({ Id: id, IfMatch: g.ETag }));
        },
      },
    ],
  },
];

void tail;

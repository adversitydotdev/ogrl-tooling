# RFC 0007: Smithy Query Sources

| Field | Value |
|---|---|
| Status | Draft |
| Spec version | 0.1.0 |
| Date | 2026-11-21 |
| Depends on | [RFC 0005](0005-integrations.md), [RFC 0006](0006-query-sources.md) |
| AI assistance | Drafted and edited with AI tools; human review in progress (see [README](https://github.com/adversitydotdev/ogrl-tooling#ai-assistance)) |

RFC 0006 defines query sources over a vendor's OpenAPI description. AWS publishes no OpenAPI; it publishes [Smithy](https://smithy.io) models for every service ([`aws/api-models-aws`](https://github.com/aws/api-models-aws), Apache-2.0). This RFC lets an integration bundle Smithy models so organizations can define query sources over AWS operations the same way. The definition, the validation feedback loop, storage, collection, evidence, and the rule preview are RFC 0006's, unchanged; this RFC specifies what differs: naming operations across services, deciding what is a read, endpoints and regions, the wire protocols, and pagination. Open questions are in [Section 10](#10-open-questions).

## 1. Summary

```yaml
integration: dev.adversity.aws
name: open-security-groups
version: 1
operation: ec2.DescribeSecurityGroups      # <service>.<Operation>
regions: "*"                               # every region the connection lists
params:
  Filters: '[{"Name": "ip-permission.cidr", "Values": ["0.0.0.0/0"]}]'
fields:
  id: GroupId
  name: GroupName
  vpc: VpcId
  rules: IpPermissions
```

Each item gains `region`. A rule then reads `dev.adversity.aws/open-security-groups@1` like any source.

The library tests this unlocks without per-check code: network boundaries (EC2 security groups, AC-04), security monitoring (GuardDuty detectors, LM-02), encryption at rest (EBS default encryption, RDS instances, KMS key rotation, CR-01), and least privilege (IAM roles and policies, AC-03).

## 2. Integration support

An integration declares the services it bundles:

```yaml
smithy:
  services:
    iam:
      model: models/iam-2010-05-08.json
      endpoint: "https://iam.amazonaws.com"
      signing_region: us-east-1               # global services sign for one region
    ec2:
      model: models/ec2-2016-11-15.json
      endpoint: "https://ec2.{region}.amazonaws.com"
    guardduty:
      model: models/guardduty-2017-11-28.json
      endpoint: "https://guardduty.{region}.amazonaws.com"
  read_operations: [iam.GenerateCredentialReport]
  deny_operations: [ec2.GetPasswordData, ec2.GetConsoleOutput, ec2.GetConsoleScreenshot, ec2.GetLaunchTemplateData]
```

- **Services** are keyed by a short name, which prefixes operations: `ec2.DescribeSecurityGroups`.
- **Models** are Smithy 2.0 JSON AST files from `aws/api-models-aws`, pinned to the package version. `pack` trims each to its read operations and the shapes they reach, and drops documentation. EC2's model shrinks from about 7 MB to a fraction of that.
- **Endpoints** are declared, not derived. An `awsJson` service whose `X-Amz-Target` predates its Smithy shape name declares `target_prefix`. An endpoint with `{region}` is regional; one without is global and signs for `signing_region`. Smithy endpoint rulesets (FIPS, dual-stack, other partitions) are not evaluated in this revision.
- **Authentication** is SigV4 with the connection's credentials (`aws_role`, RFC 0005 section 5), signing for the model's `aws.auth#sigv4` name. SigV4 moves from the AWS integration into the SDK.

## 3. What is a read

AWS models rarely carry Smithy's `@readonly` trait: none of IAM's 181 operations, EC2's 830, or S3's 112 do. And a read is not necessarily safe: `s3:GetObject` returns customer data and `ec2:GetPasswordData` returns credentials. Query sources read **configuration, not content**. An operation can be queried only if all of these hold:

1. It has `@readonly`, or its name starts with `List`, `Describe`, or `Get` followed by an upper-case letter, or it is listed in `read_operations`.
2. For REST protocols (`restJson1`, `restXml`), its `@http` method is `GET`.
3. It is not in `deny_operations`. Integration authors list every read that returns content or secrets; first-party review checks the list per release.

The connection's IAM role is the backstop: the recommended AWS-managed `SecurityAudit` policy grants configuration reads and none of the content reads above. Fathom checks these rules when a definition is saved and before every collection; the SDK checks them again in the integration process.

## 4. Operations, parameters, and fields

**Input.** `params` names top-level members of the operation's input structure. A scalar member (string, number, boolean, enum, timestamp) takes its value as a string. A list or structure member, such as EC2 `Filters`, takes JSON text, validated against the member's shape. Members bound to HTTP headers or payloads cannot be set. Pagination members (`inputToken`, `pageSize`) are reserved for the paginator.

**Items.** For a paginated operation, `items` defaults to the `@paginated` trait's `items` member and may be omitted. Otherwise it names a list member of the output; left empty, the output structure itself is the one item, as for `ec2.GetEbsEncryptionByDefault`.

**Fields.** Paths use the model's member names (`GroupId`, `IpPermissions`, `Encrypted`), dotted through structures. Types map as: string, enum, and blob to string; byte, short, integer, long, and intEnum to integer; float, double, and bigDecimal to number; boolean to boolean; timestamp to an RFC 3339 string; list and set to array; structure, map, and document to object. A member is required in the derived schema when `@required` holds at every level of its path. Two paths are reserved: `.` is the item itself, for lists of strings or numbers such as GuardDuty's detector IDs, and `$region` is the item's region, which names the single item of a regional operation:

```yaml
operation: ec2.GetEbsEncryptionByDefault
regions: "*"
fields: {id: $region, name: $region, enabled: EbsEncryptionByDefault}
```

**Regions.** `regions` is a list of region codes, or `"*"` for the connection's `regions` config. A regional operation is collected once per region and items gain a `region` field; a global operation ignores `regions`. A parameter whose value is exactly `$region` takes the region being collected, such as S3's `BucketRegion`.

**Per-item calls.** Many AWS settings are read one resource at a time: S3 encryption per bucket, the public access block per bucket. `for_each` (RFC 0006 section 3) runs a list operation first and calls `operation` once per item it returns:

```yaml
integration: dev.adversity.aws
name: bucket-encryption
version: 1
operation: s3.GetBucketEncryption
regions: "*"
for_each:
  operation: s3.ListBuckets            # same service as operation
  params: {BucketRegion: $region}      # buckets homed in the region being collected
  bind: {Bucket: Name}                 # operation parameter: path in each listed item
  limit: 1000                          # at most this many listed items (default 1000, at most 5000)
fields:
  id: $parent.BucketArn
  name: $parent.Name
  rules: ServerSideEncryptionConfiguration.Rules
```

- `for_each.operation` is queryable by Section 3, in the same service, and paginated or given `items`. `bind` names required parameters of `operation`, which `params` may not also set.
- Each call yields items as an ordinary query would. Fields may read the listed item through `$parent.<path>`.
- A call that fails with a client error other than authentication, permission, or throttling yields one item with every field empty and `error` holding the AWS error code, such as `NoSuchPublicAccessBlockConfiguration`. Items of a `for_each` query always carry `error` (null on success), so a rule can treat a missing configuration as a failure. Any other failure fails the region, as for a plain query.
- More listed items than `limit` makes the collection incomplete.

## 5. Protocols

The SDK serializes requests and deserializes responses from the model's shapes. Every protocol shares the same shape-driven reader, so a field path means the same thing whatever the wire format.

| Protocol | Services (examples) | Request | Response |
|---|---|---|---|
| `awsJson1_0`, `awsJson1_1` | CloudTrail, KMS, DynamoDB | `POST /`, `X-Amz-Target: <service shape>.<Operation>`, JSON body | JSON |
| `restJson1` | GuardDuty, Lambda | `@http` method and URI, `@httpLabel` and `@httpQuery` members | JSON, `@jsonName` honored |
| `awsQuery` | IAM, RDS, STS | `POST /`, form `Action`, `Version`, flattened members (`Name.member.1`) | XML `<Result>` wrapper, `member` lists, `@xmlName`, `@xmlFlattened` |
| `ec2Query` | EC2 | `POST /`, form with `@ec2QueryName` keys (`Filter.1.Value.1`) | XML without a `Result` wrapper, `item` lists |
| `restXml` | S3, CloudFront, Route 53 | `@http` method and URI | XML, `@xmlName`, `@xmlFlattened` |

**Pagination** follows the `@paginated` trait, merged with the service's default: the output token is sent back as the input token until it is empty or repeats. Operations without the trait return one page.

**Errors.** The AWS error code and message are added to the collection error. Throttling codes (`Throttling`, `ThrottlingException`, `RequestLimitExceeded`, and similar) are retried like HTTP 429, and access-denied codes are permission errors whatever their HTTP status.

## 6. Validation feedback

RFC 0006 section 6 applies unchanged. Static validation adds Section 3's read rules, `regions` against regional or global endpoints, and JSON parameter values against their shapes. `describe_operation` returns the flattened output item shape and the read classification, so an author or the assistant sees why an operation is or is not queryable.

## 7. Collection and evidence

Unchanged from RFC 0006 section 7. A regional query's snapshot records the regions it covered; a region that fails (for example, an opt-in region the account has not enabled) makes the snapshot incomplete, with the region and the error as the reason.

## 8. API

RFC 0006's routes serve Smithy-backed integrations without change. `GET /integrations/{id}/operations` lists operations as `<service>.<Operation>` with their protocol. Query definitions gain the optional `regions` member.

## 9. Delivery

| Step | Scope |
|---|---|
| 1 | SDK: Smithy model loading and trimming, Section 3 classification, shape-driven validation and item schemas, SigV4, and the JSON and query protocols (`awsJson1_0`, `awsJson1_1`, `restJson1`, `awsQuery`, `ec2Query`) with pagination and regions. |
| 2 | `ogrl-aws` bundles IAM, EC2, RDS, KMS, CloudTrail, and GuardDuty, and drops its hand-written SigV4 for the SDK's. |
| 3 | Fathom: the shared API-model interface over OpenAPI and Smithy; `regions` on definitions. |
| 4 | `restXml` and S3; `for_each` per-item calls. |

## 10. Open questions

1. **Endpoint rulesets.** Declared endpoints cover the commercial partition. FIPS, dual-stack, GovCloud, and China need either partition-specific declarations or an evaluator for Smithy's endpoint rules.
2. **Classifying reads.** The name-prefix rule plus a deny list is a heuristic. A reviewed allowlist per service is stricter but much longer to maintain; the deny list should grow from review and from AWS's own access-level data in the IAM service authorization reference.
3. **Model drift.** New service model versions can rename members. The upgrade check (RFC 0006 open question 3) applies.

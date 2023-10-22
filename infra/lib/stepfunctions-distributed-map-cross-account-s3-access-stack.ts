import { Duration, Stack, StackProps } from "aws-cdk-lib";
import {
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  CustomState,
  DefinitionBody,
  StateMachine,
  TaskInput,
} from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
const resolve = require("path").resolve;

export class StepfunctionsDistributedMapCrossAccountS3AccessStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const bucketProssor = new BucketProssor(this, "bucketProcessos", {
      sourceBucketName: "source-bucket-sfn-distributed-map",
    });
  }
}

class BucketProssor extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: { sourceBucketName: string }
  ) {
    super(scope, id);

    const listSourceBucket = new Bucket(this, "listBucket");

    const sourceBucket = Bucket.fromBucketName(
      this,
      "sourceBucket",
      props.sourceBucketName
    );

    const lambdaConfig = {
      memorySize: 512,
      runtime: Runtime.NODEJS_18_X,
      architecture: Architecture.ARM_64,
      logRetention: RetentionDays.THREE_DAYS,
    };

    const listSourceBucketFunction = new NodejsFunction(
      this,
      `listSourceBucketFunction`,
      {
        ...lambdaConfig,
        entry: resolve("../src/lambdas/list-source-bucket-keys.ts"),
        functionName: `list-source-bucket`,
        memorySize: 1024,
        timeout: Duration.seconds(10 * 60),
        handler: "handler",
        environment: {
          SOURCE_BUCKET: sourceBucket.bucketName,
          TARGET_BUCKET: listSourceBucket.bucketName,
        },
        role: new Role(this, "list-bucket-role", {
          assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
          roleName: "list-bucket",
          inlinePolicies: {
            ListSourceBucket: new PolicyDocument({
              statements: [
                new PolicyStatement({
                  resources: [sourceBucket.bucketArn],
                  actions: ["s3:ListBucket"],
                }),
                new PolicyStatement({
                  actions: ["s3:PutObject"],
                  resources: [`${listSourceBucket.bucketArn}/*`],
                }),
              ],
            }),
          },
        }),
      }
    );
    // listSourceBucketFunction.addToRolePolicy(
    //   new PolicyStatement({
    //     actions: ["s3:ListBucket"],
    //     resources: [sourceBucket.bucketArn],
    //   })
    // );

    // listSourceBucketFunction.addToRolePolicy(
    //   new PolicyStatement({
    //     actions: ["s3:PutObject"],
    //     resources: [`${listSourceBucket.bucketArn}/*`],
    //   })
    // );

    const processObjects = new NodejsFunction(
      this,
      `getObjectFromSourceBucket`,
      {
        ...lambdaConfig,
        entry: resolve("../src/lambdas/process-objects.ts"),
        functionName: `process-objects`,
        handler: "handler",
        timeout: Duration.seconds(5 * 60),
        environment: {
          SOURCE_BUCKET: sourceBucket.bucketName,
        },
        role: new Role(this, "process-object-role", {
          assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
          roleName: "process-objects",
          inlinePolicies: {
            ListSourceBucket: new PolicyDocument({
              statements: [
                new PolicyStatement({
                  actions: ["s3:GetObject"],
                  resources: [`${sourceBucket.bucketArn}/*`],
                }),
              ],
            }),
          },
        }),
      }
    );

    const definition = new LambdaInvoke(this, "list-bucket", {
      lambdaFunction: listSourceBucketFunction,
      payload: TaskInput.fromObject({
        "listBucketOutputFileName.$": "$$.Execution.Name",
        "prefix.$": "$.prefix",
      }),
    }).next(
      new CustomState(this, "read-objects-map", {
        stateJson: {
          Type: "Map",
          ItemProcessor: {
            ProcessorConfig: {
              Mode: "DISTRIBUTED",
              ExecutionType: "STANDARD",
            },
            StartAt: "process-objects",
            States: {
              "process-objects": {
                Type: "Task",
                Resource: "arn:aws:states:::lambda:invoke",
                OutputPath: "$.Payload",
                Parameters: {
                  "Payload.$": "$",
                  FunctionName: processObjects.functionName,
                },
                Retry: [
                  {
                    ErrorEquals: [
                      "Lambda.ServiceException",
                      "Lambda.AWSLambdaException",
                      "Lambda.SdkClientException",
                      "Lambda.TooManyRequestsException",
                    ],
                    IntervalSeconds: 1,
                    MaxAttempts: 3,
                    BackoffRate: 2,
                  },
                ],
                End: true,
              },
            },
          },
          Label: "Map",
          MaxConcurrency: 1000,
          ItemReader: {
            Resource: "arn:aws:states:::s3:getObject",
            ReaderConfig: {
              InputType: "JSON",
            },
            Parameters: {
              Bucket: listSourceBucket.bucketName,
              "Key.$": "$$.Execution.Name",
            },
          },
          ItemBatcher: {
            MaxItemsPerBatch: 20,
          },
          ResultPath: null,
        },
      })
    );

    const stateMachineName = "bucket-processor";

    const stateMachine = new StateMachine(this, "StateMachine", {
      stateMachineName,
      definitionBody: DefinitionBody.fromChainable(definition),
    });

    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [`${listSourceBucket.bucketArn}/*`],
      })
    );

    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [
          `arn:aws:states:${Stack.of(this).region}:${
            Stack.of(this).account
          }:stateMachine:${stateMachineName}`,
        ],
      })
    );

    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: [
          `arn:aws:states:${Stack.of(this).region}:${
            Stack.of(this).account
          }:stateMachine:${stateMachineName}:*`,
        ],
      })
    );

    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [processObjects.functionArn],
      })
    );
  }
}

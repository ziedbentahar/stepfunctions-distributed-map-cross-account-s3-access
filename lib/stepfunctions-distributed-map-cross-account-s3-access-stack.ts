import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export class StepfunctionsDistributedMapCrossAccountS3AccessStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const queue = new sqs.Queue(this, 'StepfunctionsDistributedMapCrossAccountS3AccessQueue', {
      visibilityTimeout: Duration.seconds(300)
    });

    const topic = new sns.Topic(this, 'StepfunctionsDistributedMapCrossAccountS3AccessTopic');

    topic.addSubscription(new subs.SqsSubscription(queue));
  }
}

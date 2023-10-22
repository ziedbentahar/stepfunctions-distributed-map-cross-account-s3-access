#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StepfunctionsDistributedMapCrossAccountS3AccessStack } from '../lib/stepfunctions-distributed-map-cross-account-s3-access-stack';

const app = new cdk.App();
new StepfunctionsDistributedMapCrossAccountS3AccessStack(app, 'StepfunctionsDistributedMapCrossAccountS3AccessStack');

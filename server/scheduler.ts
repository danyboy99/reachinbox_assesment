import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";

// Create a Redis connection
const connection = new IORedis();

// Create queues
const fetchEmailQueue = new Queue("fetchEmail", { connection });
const analyzeEmailQueue = new Queue("analyzeEmail", { connection });
const sendEmailQueue = new Queue("sendEmail", { connection });

// Create queue event
const fetchEmailEvents = new QueueEvents("fetchEmail", { connection });
const analyzeEmailEvents = new QueueEvents("analyzeEmail", { connection });
const sendEmailEvents = new QueueEvents("sendEmail", { connection });

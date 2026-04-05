'use strict';

const { v4: uuidv4 } = require('uuid');

const jobs = new Map();
const JOB_TTL_MS = 10 * 60 * 1000;

function createJob({ userId, kind }) {
  const jobId = uuidv4();
  const jobToken = uuidv4();

  const job = {
    id: jobId,
    token: jobToken,
    userId,
    kind,
    status: 'queued',
    stepIndex: 0,
    percent: 0,
    message: 'Queued',
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    listeners: new Set(),
    finished: false,
  };

  jobs.set(jobId, job);
  return { jobId, jobToken };
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function getJobSnapshot(job) {
  return {
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    stepIndex: job.stepIndex,
    percent: job.percent,
    message: job.message,
    error: job.error,
    updatedAt: job.updatedAt,
  };
}

function writeEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(job, payload) {
  for (const res of job.listeners) {
    writeEvent(res, payload);
  }
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;

  Object.assign(job, patch, { updatedAt: Date.now() });
  broadcast(job, getJobSnapshot(job));
  return getJobSnapshot(job);
}

function attachStream(jobId, res) {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (job.finished) {
    writeEvent(res, getJobSnapshot(job));
    res.end();
    return job;
  }

  job.listeners.add(res);
  writeEvent(res, getJobSnapshot(job));

  res.on('close', () => {
    job.listeners.delete(res);
  });

  return job;
}

function finalizeJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;

  Object.assign(job, patch, { updatedAt: Date.now(), finished: true });
  const snapshot = getJobSnapshot(job);

  for (const res of job.listeners) {
    writeEvent(res, snapshot);
  }

  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
  return snapshot;
}

function failJob(jobId, stepIndex, error) {
  return finalizeJob(jobId, {
    status: 'error',
    stepIndex,
    error: error.message,
    message: error.message,
  });
}

function completeJob(jobId, stepIndex, message, result) {
  return finalizeJob(jobId, {
    status: 'done',
    stepIndex,
    percent: 100,
    message,
    result,
    error: null,
  });
}

function createProgressReporter(jobId) {
  return (patch) => updateJob(jobId, {
    status: patch.status || 'progress',
    stepIndex: patch.stepIndex || 0,
    percent: typeof patch.percent === 'number' ? patch.percent : 0,
    message: patch.message || '',
    error: patch.error || null,
  });
}

function resolveJob(req) {
  const jobId = req.headers['x-job-id'];
  const jobToken = req.headers['x-job-token'];

  if (!jobId && !jobToken) return null;
  if (!jobId || !jobToken) {
    const err = new Error('Invalid progress job headers.');
    err.status = 400;
    throw err;
  }

  const job = jobs.get(jobId);
  if (!job || job.token !== jobToken || String(job.userId) !== String(req.user.id)) {
    const err = new Error('Progress job not found or access denied.');
    err.status = 403;
    throw err;
  }

  return job;
}

module.exports = {
  createJob,
  getJob,
  attachStream,
  updateJob,
  completeJob,
  failJob,
  createProgressReporter,
  resolveJob,
};

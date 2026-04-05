'use strict';

const express = require('express');
const auth = require('../middleware/auth');
const { createJob, attachStream, getJob } = require('../storage/jobStore');

const router = express.Router();

router.post('/', auth, (req, res) => {
  const kind = req.body?.kind || 'crypto';
  const job = createJob({ userId: req.user.id, kind });
  res.json(job);
});

router.get('/:jobId/events', (req, res) => {
  const { jobId } = req.params;
  const token = req.query.token;

  if (!jobId || !token) {
    return res.status(400).json({ error: 'jobId and token are required.' });
  }

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Progress job not found.' });
  }

  if (job.token !== token) {
    return res.status(403).json({ error: 'Progress job token invalid.' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  if (res.flushHeaders) res.flushHeaders();

  attachStream(jobId, res);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);

  res.on('close', () => clearInterval(heartbeat));
});

module.exports = router;

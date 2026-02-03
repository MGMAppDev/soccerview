/**
 * Pipeline Authorization Helper (CommonJS)
 * =========================================
 *
 * Session 79 - V2 Architecture Enforcement
 *
 * CommonJS version for .cjs scripts that cannot import ES modules.
 * Provides the same authorization functions as pipelineAuth.js.
 *
 * Usage:
 *   const { authorizePipelineWrite, withPipelineAuth } = require('./pipelineAuthCJS.cjs');
 *
 *   // Option 1: Manual authorization
 *   const client = await pool.connect();
 *   await authorizePipelineWrite(client);
 *   // ... do writes ...
 *   client.release();
 *
 *   // Option 2: Wrapper function (recommended)
 *   await withPipelineAuth(pool, async (client) => {
 *     await client.query('INSERT INTO teams_v2 ...');
 *   });
 */

require('dotenv').config();

/**
 * Authorize the current connection for pipeline writes.
 * Must be called before any writes to teams_v2 or matches_v2.
 *
 * @param {Pool|Client} poolOrClient - pg Pool or Client
 * @returns {Promise<void>}
 */
async function authorizePipelineWrite(poolOrClient) {
  await poolOrClient.query('SELECT authorize_pipeline_write()');
}

/**
 * Revoke pipeline authorization (optional, happens automatically at transaction end).
 *
 * @param {Pool|Client} poolOrClient - pg Pool or Client
 * @returns {Promise<void>}
 */
async function revokePipelineWrite(poolOrClient) {
  await poolOrClient.query('SELECT revoke_pipeline_write()');
}

/**
 * Execute a function with pipeline authorization.
 * Authorization is granted before and revoked after (in finally block).
 *
 * @param {Pool} pool - pg Pool
 * @param {Function} fn - Async function to execute with client parameter
 * @returns {Promise<any>} - Result of the function
 */
async function withPipelineAuth(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('SELECT authorize_pipeline_write()');
    const result = await fn(client);
    return result;
  } finally {
    // Authorization automatically revokes at transaction end,
    // but we revoke explicitly for clarity
    try {
      await client.query('SELECT revoke_pipeline_write()');
    } catch (e) {
      // Ignore errors on revoke (transaction may have ended)
    }
    client.release();
  }
}

/**
 * Execute a transaction with pipeline authorization.
 * Wraps the function in BEGIN/COMMIT with proper error handling.
 *
 * @param {Pool} pool - pg Pool
 * @param {Function} fn - Async function to execute with client parameter
 * @returns {Promise<any>} - Result of the function
 */
async function withPipelineTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT authorize_pipeline_write()');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check if write protection is currently enabled globally.
 *
 * @param {Pool|Client} poolOrClient - pg Pool or Client
 * @returns {Promise<boolean>}
 */
async function isWriteProtectionEnabled(poolOrClient) {
  const { rows } = await poolOrClient.query('SELECT is_write_protection_enabled() as enabled');
  return rows[0]?.enabled ?? true;
}

/**
 * EMERGENCY: Disable write protection globally.
 * Use only when absolutely necessary!
 *
 * @param {Pool|Client} poolOrClient - pg Pool or Client
 * @returns {Promise<void>}
 */
async function disableWriteProtection(poolOrClient) {
  console.warn('⚠️  DISABLING WRITE PROTECTION - Emergency mode activated');
  await poolOrClient.query('SELECT disable_write_protection()');
}

/**
 * Re-enable write protection after emergency disable.
 *
 * @param {Pool|Client} poolOrClient - pg Pool or Client
 * @returns {Promise<void>}
 */
async function enableWriteProtection(poolOrClient) {
  console.log('✅ Re-enabling write protection');
  await poolOrClient.query('SELECT enable_write_protection()');
}

module.exports = {
  authorizePipelineWrite,
  revokePipelineWrite,
  withPipelineAuth,
  withPipelineTransaction,
  isWriteProtectionEnabled,
  disableWriteProtection,
  enableWriteProtection,
};

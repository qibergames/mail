export function getBackupWorkflow(env: CloudflareEnv) {
  const workflow = env.DATABASE_BACKUP_WORKFLOW as CloudflareEnv['DATABASE_BACKUP_WORKFLOW'] | undefined
  if (!workflow || typeof workflow.create !== 'function') throw new Error('Database backup workflow is not configured')
  return workflow
}

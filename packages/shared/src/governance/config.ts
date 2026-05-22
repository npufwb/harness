import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../logger.js';
import { builtinRules, type ApprovalRule } from './rules.js';

export interface GovernanceConfig {
  approvalRequired: string[];
  rules: string[];
}

const DEFAULT_CONFIG: GovernanceConfig = {
  approvalRequired: [],
  rules: ['sensitive-data'],
};

export class GovernanceManager {
  private config: GovernanceConfig;
  private rules: ApprovalRule[];
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? resolve(process.cwd(), 'governance.json');
    this.config = DEFAULT_CONFIG;
    this.rules = [...builtinRules];
    this.loadConfig();
  }

  private loadConfig(): void {
    if (!existsSync(this.configPath)) {
      logger.info({ path: this.configPath }, 'Governance config not found, using defaults');
      return;
    }

    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(raw) as GovernanceConfig;
      logger.info({ config: this.config }, 'Governance config loaded');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: msg, path: this.configPath }, 'Failed to load governance config');
    }
  }

  reloadConfig(): void {
    this.loadConfig();
  }

  getApprovalRequiredTools(): string[] {
    return this.config.approvalRequired;
  }

  getRules(): ApprovalRule[] {
    return this.rules;
  }

  addRule(rule: ApprovalRule): void {
    this.rules.push(rule);
  }
}

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  loadScenarioContent,
  scenarioContentPath,
} from './scenario-content.js';
import { ScenariosService } from './scenarios.service.js';

const INTERNAL_FIELDS = ['transfer', 'coachRole', 'followUp'];

describe('ScenariosService', () => {
  const service = new ScenariosService(
    loadScenarioContent(scenarioContentPath()),
  );

  it('lists every scenario without internal fields', () => {
    const list = service.list();
    expect(list).toHaveLength(20);
    for (const item of list) {
      for (const field of [...INTERNAL_FIELDS, 'opening', 'hints']) {
        expect(item).not.toHaveProperty(field);
      }
    }
  });

  it('filters by pack', () => {
    const seller = service.list('seller');
    expect(seller).toHaveLength(8);
    expect(seller.every((s) => s.pack === 'seller')).toBe(true);
  });

  it('rejects an unknown pack', () => {
    expect(() => service.list('teacher')).toThrow(BadRequestException);
  });

  it('returns one scenario with its opening, without hints or the transfer task', () => {
    const detail = service.get('pro-interview-01');
    expect(detail.opening).toBe(
      'Thanks for joining. To start, could you tell me a little about yourself?',
    );
    for (const field of [...INTERNAL_FIELDS, 'hints']) {
      expect(detail).not.toHaveProperty(field);
    }
  });

  it('throws NotFound for an unknown scenario', () => {
    expect(() => service.get('pro-interview-99')).toThrow(NotFoundException);
  });

  it('keeps the full scenario available for server-side use', () => {
    expect(service.findInternal('pro-interview-01')?.transfer.question).toBe(
      'Nice to meet you! So, what do you do?',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { LlmError } from './errors';
import { generateValidated, parseJsonText, REVIEW_SCHEMAS, toJsonSchema, validateAgainstSchema } from './structured';
import { REQUEST, VALID_RESULT } from './test-helpers';

describe('toJsonSchema', () => {
  it('轉成小寫 JSON Schema 型別並保留 enum 與 nullable', () => {
    const schema = toJsonSchema(REVIEW_SCHEMAS.analysis) as any;
    expect(schema.type).toBe('object');
    const review = schema.properties.reviews.items;
    expect(review.properties.category.enum).toContain('bug');
    expect(review.properties.line.type).toEqual(['integer', 'null']);
    expect(review.required).not.toContain('line');
  });

  it('strict 模式：所有 object 都 additionalProperties:false、所有欄位 required，選填改為可 null', () => {
    const schema = toJsonSchema(REVIEW_SCHEMAS.analysis, true) as any;
    const walk = (n: any) => {
      if (n.type === 'object' || (Array.isArray(n.type) && n.type.includes('object'))) {
        expect(n.additionalProperties).toBe(false);
        expect([...n.required].sort()).toEqual(Object.keys(n.properties).sort());
        Object.values(n.properties).forEach(walk);
      }
      if (n.items) walk(n.items);
    };
    walk(schema);
    const review = schema.properties.reviews.items;
    expect(review.properties.checklistId.type).toEqual(['string', 'null']);
    expect(schema.properties.graph.properties.edges.items.properties.label.type).toEqual(['string', 'null']);
  });
});

describe('validateAgainstSchema（共用 schema validator）', () => {
  it('合法結果與內建範例結果通過驗證', () => {
    expect(validateAgainstSchema(VALID_RESULT, REVIEW_SCHEMAS.analysis)).toEqual([]);
    expect(validateAgainstSchema(SAMPLE_ANALYSIS_RESULT, REVIEW_SCHEMAS.analysis)).toEqual([]);
  });

  it('strict 模式回傳的 null 選填欄位可接受', () => {
    const value = {
      checklistCoverage: [],
      reviews: [
        { groupId: 'g', checklistId: null, category: 'bug', severity: 'high', file: 'a.ts', line: null, codeSnippet: 'x', comment: 'c', suggestion: 's' },
      ],
    };
    expect(validateAgainstSchema(value, REVIEW_SCHEMAS.recheck)).toEqual([]);
  });

  it('缺必要欄位、型別錯誤、enum 不合法時回報路徑', () => {
    const bad = {
      ...VALID_RESULT,
      title: 1,
      summary: 'x',
      reviews: [{ groupId: 'g', category: 'nitpick', severity: 'high', file: 'a.ts', codeSnippet: 'x', comment: 'c' }],
    } as unknown;
    delete (bad as any).graph;
    const errors = validateAgainstSchema(bad, REVIEW_SCHEMAS.analysis);
    expect(errors).toEqual(
      expect.arrayContaining([
        '$.graph 缺少必要欄位',
        '$.title 應為字串',
        '$.summary 應為陣列',
        '$.reviews[0].suggestion 缺少必要欄位',
        expect.stringContaining('$.reviews[0].category 值「nitpick」'),
      ])
    );
  });

  it('根節點不是物件時失敗', () => {
    expect(validateAgainstSchema([], REVIEW_SCHEMAS.analysis)).toEqual(['$ 應為物件']);
    expect(validateAgainstSchema(null, REVIEW_SCHEMAS.analysis)).toEqual(['$ 不可為 null']);
  });
});

describe('parseJsonText', () => {
  it('容許 ```json 圍欄與前後文字', () => {
    expect(parseJsonText('X', '```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('X', '結果如下：{"a":2} 以上')).toEqual({ a: 2 });
  });

  it('無法解析時丟 invalid_output', () => {
    expect(() => parseJsonText('X', 'not json')).toThrow(LlmError);
  });
});

describe('generateValidated', () => {
  it('第一次 schema 驗證失敗會重試一次，第二次成功即回傳', async () => {
    let n = 0;
    const result = await generateValidated('X', REQUEST, async () => (++n === 1 ? { title: 'only' } : VALID_RESULT));
    expect(n).toBe(2);
    expect(result.title).toBe('新增分頁');
  });

  it('連續兩次失敗後報錯，訊息列出不符合的欄位', async () => {
    let n = 0;
    await expect(generateValidated('X', REQUEST, async () => (n++, { title: 'only' }))).rejects.toThrow(
      /X 輸出格式錯誤（已重試 1 次）.*缺少必要欄位/
    );
    expect(n).toBe(2);
  });

  it('JSON 解析失敗也會重試一次', async () => {
    let n = 0;
    const result = await generateValidated('X', REQUEST, async () =>
      ++n === 1 ? parseJsonText('X', '{oops') : VALID_RESULT
    );
    expect(n).toBe(2);
    expect(result.schemaVersion).toBe(1);
  });

  it('金鑰、額度等錯誤不重試', async () => {
    let n = 0;
    await expect(
      generateValidated('X', REQUEST, async () => {
        n++;
        throw new LlmError('auth', 'bad key', 401);
      })
    ).rejects.toThrow('bad key');
    expect(n).toBe(1);
  });
});

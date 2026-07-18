import { describe, it, expect, vi } from 'vitest'
import { CanvasEdgeStore } from '../canvas-edge-store.js'
import { CanvasEdgeRepository } from '../db/repositories/canvas-edge.repository.js'

vi.mock('../db/repositories/canvas-edge.repository.js', () => ({
  CanvasEdgeRepository: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(),
    getEdgesForSession: vi.fn(),
  })),
}))

describe('CanvasEdgeStore', () => {
  function createStoreWithMockRepo(mockRepo: any) {
    vi.mocked(CanvasEdgeRepository).mockImplementationOnce(() => mockRepo)
    return new CanvasEdgeStore({} as any)
  }

  it('creates an edge through repository', () => {
    const edge = {
      id: 'edge-1',
      sourceSessionId: 's1',
      targetSessionId: 's2',
      trigger: 'on-complete' as const,
      injectContext: true,
    }
    const mockRepo = {
      create: vi.fn().mockReturnValue(edge),
      delete: vi.fn(),
      getAll: vi.fn(),
      getEdgesForSession: vi.fn(),
    }
    const store = createStoreWithMockRepo(mockRepo)

    const result = store.createEdge({
      sourceSessionId: 's1',
      targetSessionId: 's2',
      trigger: 'on-complete',
      injectContext: true,
    })

    expect(result).toBe(edge)
    expect(mockRepo.create).toHaveBeenCalledWith({
      sourceSessionId: 's1',
      targetSessionId: 's2',
      trigger: 'on-complete',
      injectContext: true,
    })
  })

  it('deletes an edge through repository', () => {
    const mockRepo = {
      create: vi.fn(),
      delete: vi.fn().mockReturnValue(true),
      getAll: vi.fn(),
      getEdgesForSession: vi.fn(),
    }
    const store = createStoreWithMockRepo(mockRepo)

    const result = store.deleteEdge('edge-1')

    expect(result).toBe(true)
    expect(mockRepo.delete).toHaveBeenCalledWith('edge-1')
  })

  it('returns all edges through repository', () => {
    const edges = [{ id: 'edge-1', sourceSessionId: 's1', targetSessionId: 's2', trigger: 'on-complete' as const, injectContext: false }]
    const mockRepo = {
      create: vi.fn(),
      delete: vi.fn(),
      getAll: vi.fn().mockReturnValue(edges),
      getEdgesForSession: vi.fn(),
    }
    const store = createStoreWithMockRepo(mockRepo)

    expect(store.getAllEdges()).toBe(edges)
    expect(mockRepo.getAll).toHaveBeenCalled()
  })

  it('returns edges for session through repository', () => {
    const edges = [{ id: 'edge-1', sourceSessionId: 's1', targetSessionId: 's2', trigger: 'on-complete' as const, injectContext: false }]
    const mockRepo = {
      create: vi.fn(),
      delete: vi.fn(),
      getAll: vi.fn(),
      getEdgesForSession: vi.fn().mockReturnValue(edges),
    }
    const store = createStoreWithMockRepo(mockRepo)

    expect(store.getEdgesForSession('s1')).toBe(edges)
    expect(mockRepo.getEdgesForSession).toHaveBeenCalledWith('s1')
  })
})

export class SerialMutationQueue {
  private tail: Promise<void> = Promise.resolve()

  enqueue(operation: () => Promise<unknown>): void {
    void this.runAfterPending(operation)
  }

  runAfterPending(operation: () => Promise<unknown>): Promise<void> {
    this.tail = this.tail
      .catch(() => undefined)
      .then(async () => { await operation() })
      .catch(() => undefined)
    return this.tail
  }
}

export const sessionMutationQueue = new SerialMutationQueue()
export const collectionMutationQueue = new SerialMutationQueue()

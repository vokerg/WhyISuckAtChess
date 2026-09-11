export class ReplayStepper {
  private totalPlyCount = 0;
  private selectedPlyNumber = 0;

  get currentPly(): number {
    return this.selectedPlyNumber;
  }

  get totalPlies(): number {
    return this.totalPlyCount;
  }

  setTotalPlies(totalPlies: number): void {
    this.totalPlyCount = Number.isInteger(totalPlies) && totalPlies > 0 ? totalPlies : 0;
    this.selectedPlyNumber = Math.min(this.selectedPlyNumber, this.totalPlyCount);
  }

  select(plyNumber: number): number {
    if (!Number.isInteger(plyNumber) || plyNumber < 0 || plyNumber > this.totalPlyCount) {
      return this.selectedPlyNumber;
    }
    this.selectedPlyNumber = plyNumber;
    return this.selectedPlyNumber;
  }

  goToStart(): number {
    return this.select(0);
  }

  goToPrevious(): number {
    return this.select(Math.max(0, this.selectedPlyNumber - 1));
  }

  goToNext(): number {
    return this.select(Math.min(this.totalPlyCount, this.selectedPlyNumber + 1));
  }

  goToEnd(): number {
    return this.select(this.totalPlyCount);
  }
}

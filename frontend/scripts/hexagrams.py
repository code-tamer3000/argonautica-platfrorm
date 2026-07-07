#!/usr/bin/env python3
"""
King Wen hexagram lines for all 64 hexagrams.

Standard King Wen sequence -> 6 lines, bottom (line 1) to top (line 6).
1 = solid (yang), 0 = broken (yin).

We encode each hexagram as a string of 6 chars, line1..line6.
This is the canonical, well-known table (Wilhelm/Baynes ordering).
"""

# King Wen № : lines bottom->top ("1"=yang solid, "0"=yin broken)
KING_WEN = {
    1:  "111111", 2:  "000000", 3:  "100010", 4:  "010001",
    5:  "111010", 6:  "010111", 7:  "010000", 8:  "000010",
    9:  "111011", 10: "110111", 11: "111000", 12: "000111",
    13: "101111", 14: "111101", 15: "001000", 16: "000100",
    17: "100110", 18: "011001", 19: "110000", 20: "000011",
    21: "100101", 22: "101001", 23: "000001", 24: "100000",
    25: "100111", 26: "111001", 27: "100001", 28: "011110",
    29: "010010", 30: "101101", 31: "001110", 32: "011100",
    33: "001111", 34: "111100", 35: "000101", 36: "101000",
    37: "101011", 38: "110101", 39: "001010", 40: "010100",
    41: "110001", 42: "100011", 43: "111110", 44: "011111",
    45: "000110", 46: "011000", 47: "010110", 48: "011010",
    49: "101110", 50: "011101", 51: "100100", 52: "001001",
    53: "001011", 54: "110100", 55: "101100", 56: "001101",
    57: "011011", 58: "110110", 59: "010011", 60: "110010",
    61: "110011", 62: "001100", 63: "101010", 64: "010101",
}


def verify():
    assert len(KING_WEN) == 64
    # all distinct
    assert len(set(KING_WEN.values())) == 64, "duplicate line patterns!"
    # each is 6 chars of 0/1
    for n, v in KING_WEN.items():
        assert len(v) == 6 and set(v) <= {"0", "1"}, (n, v)
    # King Wen pairing rule: consecutive odd/even pairs are either
    # inverse (upside-down) or complement of each other. Spot-check a few.
    print("all 64 present, all distinct, well-formed")
    print("hex 1:", KING_WEN[1], " hex 2:", KING_WEN[2])
    print("hex 63:", KING_WEN[63], " hex 64:", KING_WEN[64])


if __name__ == "__main__":
    verify()

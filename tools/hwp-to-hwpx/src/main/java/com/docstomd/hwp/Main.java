package com.docstomd.hwp;

import kr.dogfoot.hwp2hwpx.Hwp2Hwpx;
import kr.dogfoot.hwplib.object.HWPFile;
import kr.dogfoot.hwplib.reader.HWPReader;
import kr.dogfoot.hwpxlib.object.HWPXFile;
import kr.dogfoot.hwpxlib.writer.HWPXWriter;

/**
 * docs-to-md HWP → HWPX CLI wrapper.
 *
 * Usage:
 *   java -jar hwp-to-hwpx.jar &lt;input.hwp&gt; &lt;output.hwpx&gt;
 *
 * Exit codes:
 *   0 - success
 *   1 - invalid arguments
 *   2 - read/parse failure (HWP 파일 오류)
 *   3 - conversion failure (hwp2hwpx 변환 오류)
 *   4 - write failure (HWPX 저장 오류)
 *
 * All error messages are written to stderr in Korean.
 */
public final class Main {

    private Main() {
        // utility class
    }

    public static void main(final String[] args) {
        if (args.length != 2) {
            System.err.println("사용법: java -jar hwp-to-hwpx.jar <input.hwp> <output.hwpx>");
            System.exit(1);
            return;
        }

        final String inputPath = args[0];
        final String outputPath = args[1];

        final HWPFile hwpFile;
        try {
            hwpFile = HWPReader.fromFile(inputPath);
            if (hwpFile == null) {
                System.err.println("HWP 파일을 읽을 수 없습니다: " + inputPath);
                System.exit(2);
                return;
            }
        } catch (final Exception e) {
            System.err.println("HWP 파일 읽기 실패: " + e.getMessage());
            System.exit(2);
            return;
        }

        final HWPXFile hwpxFile;
        try {
            hwpxFile = Hwp2Hwpx.toHWPX(hwpFile);
            if (hwpxFile == null) {
                System.err.println("HWP→HWPX 변환 결과가 비어 있습니다.");
                System.exit(3);
                return;
            }
        } catch (final Exception e) {
            System.err.println("HWP→HWPX 변환 실패: " + e.getMessage());
            System.exit(3);
            return;
        }

        try {
            HWPXWriter.toFilepath(hwpxFile, outputPath);
        } catch (final Exception e) {
            System.err.println("HWPX 파일 저장 실패: " + e.getMessage());
            System.exit(4);
            return;
        }

        // success — nothing on stdout; caller inspects outputPath
    }
}

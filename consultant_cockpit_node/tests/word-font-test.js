/**
 * 测试 Node.js docx 包生成中文 Word 文档的可行性
 * 验证中文字体渲染是否正常
 */

const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

async function testChineseFont() {
  console.log('开始测试 docx 包生成中文 Word 文档...\n');

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // 标题：微软雅黑 14pt 加粗
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: '中文标题测试',
              bold: true,
              size: 28,  // 14pt = 28 half-points
              font: '微软雅黑'
            })
          ]
        }),

        // 空行
        new Paragraph({
          children: []
        }),

        // 正文：微软雅黑 10pt
        new Paragraph({
          children: [
            new TextRun({
              text: '这是中文正文内容，测试字体渲染是否正常。本文档用于验证 Node.js docx 包对中文字体的支持情况。',
              size: 20,  // 10pt = 20 half-points
              font: '微软雅黑'
            })
          ]
        }),

        // 空行
        new Paragraph({
          children: []
        }),

        // 副标题
        new Paragraph({
          children: [
            new TextRun({
              text: '列表项测试：',
              bold: true,
              size: 22,  // 11pt
              font: '微软雅黑'
            })
          ]
        }),

        // 列表项 1
        new Paragraph({
          indent: { left: 360 },  // 缩进
          children: [
            new TextRun({
              text: '1. 第一项：支持中文字体设置',
              size: 20,
              font: '微软雅黑'
            })
          ]
        }),

        // 列表项 2
        new Paragraph({
          indent: { left: 360 },
          children: [
            new TextRun({
              text: '2. 第二项：支持多种字号',
              size: 20,
              font: '微软雅黑'
            })
          ]
        }),

        // 列表项 3
        new Paragraph({
          indent: { left: 360 },
          children: [
            new TextRun({
              text: '3. 第三项：支持加粗、斜体等样式',
              size: 20,
              font: '微软雅黑'
            })
          ]
        }),

        // 空行
        new Paragraph({
          children: []
        }),

        // 混合样式测试
        new Paragraph({
          children: [
            new TextRun({
              text: '混合样式：',
              bold: true,
              size: 20,
              font: '微软雅黑'
            }),
            new TextRun({
              text: '普通文本、',
              size: 20,
              font: '微软雅黑'
            }),
            new TextRun({
              text: '加粗文本、',
              bold: true,
              size: 20,
              font: '微软雅黑'
            }),
            new TextRun({
              text: '斜体文本',
              italics: true,
              size: 20,
              font: '微软雅黑'
            })
          ]
        }),

        // 空行
        new Paragraph({
          children: []
        }),

        // 英文混合测试
        new Paragraph({
          children: [
            new TextRun({
              text: '中英文混合测试：This is English text mixed with 中文内容。',
              size: 20,
              font: '微软雅黑'
            })
          ]
        }),

        // 空行
        new Paragraph({
          children: []
        }),

        // 结论
        new Paragraph({
          children: [
            new TextRun({
              text: '测试结论：',
              bold: true,
              size: 22,
              font: '微软雅黑'
            })
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: '如果以上内容显示正常，说明 Node.js docx 包可以正确生成中文 Word 文档。',
              size: 20,
              font: '微软雅黑'
            })
          ]
        })
      ]
    }]
  });

  // 生成文件
  const outputPath = path.join(__dirname, 'output', 'chinese-test.docx');
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  console.log('✅ Word 文档已生成');
  console.log(`📄 文件路径: ${outputPath}`);
  console.log(`📊 文件大小: ${buffer.length} bytes`);
  console.log('\n请用 Microsoft Word 打开文件验证中文字体渲染效果。');
}

// 运行测试
testChineseFont().catch(err => {
  console.error('❌ 测试失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});

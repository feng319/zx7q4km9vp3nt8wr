// 测试字段提取
const content = '毛利结构：储能系统集成毛利约18%，EPC工程毛利约12%';
const fieldNames = ['产品线', '客户群体', '收入结构', '毛利结构', '交付情况', '资源分布', '战略目标', '显性诉求', '当前追问', '诊断进度'];
const profileData = {};
for (const field of fieldNames) {
  const regex = new RegExp(`${field}[:：]\\s*(.+?)(?:[。\\n]|$)`, 's');
  const match = content.match(regex);
  console.log(`Field: ${field}, Match:`, match);
  if (match && match[1]) {
    profileData[field] = match[1].trim();
  }
}
console.log('Extracted:', JSON.stringify(profileData, null, 2));

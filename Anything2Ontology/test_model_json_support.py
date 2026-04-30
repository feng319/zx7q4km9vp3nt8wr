"""测试模型是否支持 response_format 参数"""

import os
from openai import OpenAI

# 从环境变量获取配置
api_key = "96af8899-ad50-45d8-a327-27d9af54a3a0"
base_url = "https://ark.cn-beijing.volces.com/api/v3"
model_id = "ep-m-20260320122633-qplf7"

print(f"Testing model: {model_id}")
print(f"Base URL: {base_url}")
print("-" * 50)

client = OpenAI(api_key=api_key, base_url=base_url)

# 测试1：普通调用
print("\n[测试1] 普通调用（无 response_format）")
try:
    response = client.chat.completions.create(
        model=model_id,
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "简单回答：1+1等于几？"}
        ],
        max_tokens=100,
    )
    result = response.choices[0].message.content
    print(f"✅ 成功: {result}")
except Exception as e:
    print(f"❌ 失败: {e}")

# 测试2：使用 response_format
print("\n[测试2] 使用 response_format={'type': 'json_object'}")
try:
    response = client.chat.completions.create(
        model=model_id,
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "返回JSON：{'result': 1+1}"}
        ],
        response_format={"type": "json_object"},
        max_tokens=100,
    )
    result = response.choices[0].message.content
    print(f"✅ 成功: {result}")
except Exception as e:
    print(f"❌ 失败: {e}")

# 测试3：使用不同的 response_format 格式
print("\n[测试3] 使用 response_format='json_object'（字符串）")
try:
    response = client.chat.completions.create(
        model=model_id,
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "返回JSON：{'result': 1+1}"}
        ],
        response_format="json_object",
        max_tokens=100,
    )
    result = response.choices[0].message.content
    print(f"✅ 成功: {result}")
except Exception as e:
    print(f"❌ 失败: {e}")

print("\n" + "=" * 50)
print("测试完成")

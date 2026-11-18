namespace MossCore;

/// <summary>构建渠道：dev=测试版（含测试工具），release=正式版（只留必要的 API 配置与自检）</summary>
internal static class ChannelInfo
{
#if MOSS_RELEASE
    public const bool IsRelease = true;
    public const string Name = "release";
#else
    public const bool IsRelease = false;
    public const string Name = "dev";
#endif
}

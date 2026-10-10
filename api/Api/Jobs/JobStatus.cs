using Azure;
using Azure.Data.Tables;

namespace Api.Jobs;

/// <summary>
/// Status eines Jobs in der Tabelle <c>jobs</c>: PartitionKey ist die Eigentümerin (oid),
/// RowKey die Job-ID. Der ETag schützt vor gleichzeitigen Änderungen.
/// </summary>
public sealed class JobStatus : ITableEntity
{
    /// <summary>Tabelle aus project.yaml (storage.tables).</summary>
    public const string TableName = "jobs";

    public const string Queued = "queued";
    public const string Running = "running";
    public const string Done = "done";
    public const string Failed = "failed";

    public string PartitionKey { get; set; } = string.Empty;

    public string RowKey { get; set; } = string.Empty;

    public DateTimeOffset? Timestamp { get; set; }

    public ETag ETag { get; set; }

    public string Status { get; set; } = Queued;

    public string Input { get; set; } = string.Empty;

    public string? Result { get; set; }

    /// <summary>Zahl der Verarbeitungsversuche; die Queue liefert mindestens einmal.</summary>
    public int Attempts { get; set; }
}

/// <summary>Nachricht in der Queue <c>jobs</c>: nur der Verweis, die Daten stehen in der Tabelle.</summary>
public sealed record JobMessage(string PartitionKey, string JobId);

/// <summary>Anfrage an <c>POST /api/jobs</c>.</summary>
public sealed record JobRequest(string? Input);

/// <summary>Antwort mit dem Status eines Jobs.</summary>
public sealed record JobResponse(string Id, string Status, string? Result, int Attempts)
{
    public static JobResponse From(JobStatus job) => new(job.RowKey, job.Status, job.Result, job.Attempts);
}
